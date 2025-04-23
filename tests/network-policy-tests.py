import pytest
import time
import logging
from kubernetes import client, config, stream
from kubernetes.client.rest import ApiException

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

# Load Kubernetes config (adjust if running outside the cluster)
try:
    config.load_kube_config()
except config.ConfigException:
    config.load_incluster_config()

k8s_core_v1 = client.CoreV1Api()
k8s_apps_v1 = client.AppsV1Api()

TESTER_IMAGE = "busybox:latest" # Simple image with network tools like nc, wget
DEFAULT_TIMEOUT_SECONDS = 10 # Timeout for connection attempts

# Define namespaces and services for testing (adjust for your homelab)
NAMESPACES = {
    "default_deny": "test-deny",
    "allow_specific": "test-allow",
    "isolated_a": "test-iso-a",
    "isolated_b": "test-iso-b",
    "egress_controlled": "test-egress",
}

SERVICES = {
    "target_allowed": {"name": "target-svc-allowed", "namespace": NAMESPACES["allow_specific"], "port": 80},
    "target_denied": {"name": "target-svc-denied", "namespace": NAMESPACES["allow_specific"], "port": 80},
    "target_iso_a": {"name": "target-svc-iso-a", "namespace": NAMESPACES["isolated_a"], "port": 80},
    "target_iso_b": {"name": "target-svc-iso-b", "namespace": NAMESPACES["isolated_b"], "port": 80},
}

EXTERNAL_ALLOWED = "google.com:80"
EXTERNAL_DENIED = "example.com:80" # Assume this is blocked by egress policy

# --- Helper Functions ---

def create_namespace(name):
    """Creates a Kubernetes namespace if it doesn't exist."""
    try:
        k8s_core_v1.read_namespace(name=name)
        logging.info(f"Namespace '{name}' already exists.")
    except ApiException as e:
        if e.status == 404:
            ns = client.V1Namespace(metadata=client.V1ObjectMeta(name=name))
            k8s_core_v1.create_namespace(body=ns)
            logging.info(f"Namespace '{name}' created.")
            time.sleep(2) # Allow time for namespace creation
        else:
            raise

def delete_namespace(name):
    """Deletes a Kubernetes namespace."""
    try:
        k8s_core_v1.delete_namespace(name=name)
        logging.info(f"Namespace '{name}' deletion requested.")
        # Wait for deletion? Might take time. For tests, maybe skip waiting.
    except ApiException as e:
        if e.status != 404:
            logging.error(f"Error deleting namespace '{name}': {e}")

def create_deployment(name, namespace, labels=None):
    """Creates a simple deployment (e.g., nginx) to act as a target."""
    dep_labels = labels or {"app": name}
    deployment = client.V1Deployment(
        metadata=client.V1ObjectMeta(name=name, namespace=namespace, labels=dep_labels),
        spec=client.V1DeploymentSpec(
            replicas=1,
            selector=client.V1LabelSelector(match_labels=dep_labels),
            template=client.V1PodTemplateSpec(
                metadata=client.V1ObjectMeta(labels=dep_labels),
                spec=client.V1PodSpec(containers=[
                    client.V1Container(name="nginx", image="nginx:alpine", ports=[client.V1ContainerPort(container_port=80)])
                ])
            )
        )
    )
    try:
        k8s_apps_v1.create_namespaced_deployment(namespace=namespace, body=deployment)
        logging.info(f"Deployment '{name}' created in namespace '{namespace}'.")
        # Wait for deployment readiness?
    except ApiException as e:
         if e.status == 409: # Already exists
             logging.info(f"Deployment '{name}' already exists in namespace '{namespace}'.")
         else:
             raise

def create_service(name, namespace, port, labels=None):
    """Creates a ClusterIP service for a deployment."""
    svc_labels = labels or {"app": name}
    service = client.V1Service(
        metadata=client.V1ObjectMeta(name=name, namespace=namespace),
        spec=client.V1ServiceSpec(
            selector=svc_labels,
            ports=[client.V1ServicePort(protocol="TCP", port=port, target_port=80)] # Assumes target port 80
        )
    )
    try:
        k8s_core_v1.create_namespaced_service(namespace=namespace, body=service)
        logging.info(f"Service '{name}' created in namespace '{namespace}'.")
    except ApiException as e:
         if e.status == 409: # Already exists
             logging.info(f"Service '{name}' already exists in namespace '{namespace}'.")
         else:
             raise

def run_pod_command(pod_name, namespace, command, timeout=DEFAULT_TIMEOUT_SECONDS):
    """Executes a command in a pod and returns stdout/stderr."""
    try:
        # Command needs to handle timeout itself if possible (e.g., nc -w)
        # Here we use the stream timeout, which might not kill the remote process
        resp = stream.stream(k8s_core_v1.connect_get_namespaced_pod_exec,
                             pod_name,
                             namespace,
                             command=['/bin/sh', '-c', command],
                             stderr=True, stdin=False,
                             stdout=True, tty=False,
                             _request_timeout=timeout + 5) # K8s client timeout
        logging.debug(f"Exec result for '{command}' in {pod_name}: {resp}")
        return resp
    except ApiException as e:
        logging.error(f"Exec failed for '{command}' in {pod_name}: {e}")
        return f"Exec failed: {e}"
    except Exception as e:
        # Catches potential timeouts from the stream call itself
        logging.error(f"Exec stream failed for '{command}' in {pod_name}: {e}")
        return f"Stream failed: {e}"


def can_connect_from_pod(pod_name, namespace, target_host, target_port, timeout=DEFAULT_TIMEOUT_SECONDS):
    """Checks if a pod can connect to a target using netcat."""
    # Use netcat with a timeout (-w) and zero-I/O mode (-z)
    command = f"nc -w {timeout} -z {target_host} {target_port}"
    result = run_pod_command(pod_name, namespace, command, timeout=timeout)
    # Successful connection returns exit code 0, nc might not print anything on success
    # Check for common failure messages or assume success if no error message
    return "failed" not in result.lower() and "error" not in result.lower() and "timeout" not in result.lower()

# --- Fixtures ---

@pytest.fixture(scope="module", autouse=True)
def setup_namespaces():
    """Create all necessary namespaces before tests."""
    logging.info("Setting up test namespaces...")
    for ns in NAMESPACES.values():
        create_namespace(ns)
    yield
    logging.info("Tearing down test namespaces...")
    # for ns in NAMESPACES.values():
    #     delete_namespace(ns) # Optional: clean up namespaces after tests

@pytest.fixture(scope="module", autouse=True)
def setup_target_services():
    """Create dummy target services for connection tests."""
    logging.info("Setting up target services...")
    for svc_key, svc_info in SERVICES.items():
        create_deployment(svc_info["name"], svc_info["namespace"])
        create_service(svc_info["name"], svc_info["namespace"], svc_info["port"])
    # Wait briefly for services/endpoints to become available
    time.sleep(10)

@pytest.fixture(scope="function") # Create a new pod for each test function
def tester_pod(request):
    """Creates a temporary 'tester' pod in a specified namespace."""
    namespace = request.param # Get namespace from test parameterization
    pod_name = f"tester-pod-{namespace}-{int(time.time())}"
    pod_manifest = {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {"name": pod_name, "namespace": namespace},
        "spec": {
            "containers": [{
                "name": "tester",
                "image": TESTER_IMAGE,
                "command": ["sleep", "3600"] # Keep pod running
            }],
            "restartPolicy": "Never",
        },
    }
    logging.info(f"Creating tester pod '{pod_name}' in namespace '{namespace}'...")
    k8s_core_v1.create_namespaced_pod(body=pod_manifest, namespace=namespace)

    # Wait for the pod to be running
    retries = 10
    while retries > 0:
        try:
            pod_status = k8s_core_v1.read_namespaced_pod_status(pod_name, namespace)
            if pod_status.status.phase == "Running":
                logging.info(f"Tester pod '{pod_name}' is running.")
                break
        except ApiException as e:
            logging.warning(f"Error getting pod status for {pod_name}: {e}")
        retries -= 1
        time.sleep(3)
    else:
        pytest.fail(f"Tester pod '{pod_name}' did not become ready in time.")

    yield pod_name, namespace # Provide pod name and namespace to the test

    # Teardown: delete the pod
    logging.info(f"Deleting tester pod '{pod_name}'...")
    try:
        k8s_core_v1.delete_namespaced_pod(pod_name, namespace, body=client.V1DeleteOptions())
    except ApiException as e:
        if e.status != 404:
            logging.error(f"Failed to delete tester pod '{pod_name}': {e}")


# --- Test Cases ---

@pytest.mark.parametrize("tester_pod", [NAMESPACES["default_deny"]], indirect=True)
def test_default_deny_effectiveness(tester_pod):
    """Verify that default deny blocks traffic within and across namespaces."""
    pod_name, namespace = tester_pod
    target_svc_info = SERVICES["target_allowed"] # Use any service as target
    target_host = f"{target_svc_info['name']}.{target_svc_info['namespace']}.svc"
    target_port = target_svc_info['port']

    logging.info(f"Testing default deny from {pod_name} in {namespace}...")

    # Test connection to a service in another namespace (should be denied)
    assert not can_connect_from_pod(pod_name, namespace, target_host, target_port), \
        f"Default deny failed: Pod {pod_name} connected to {target_host}:{target_port}"

    # Optional: Test connection to another pod within the same namespace (if applicable)
    # This requires creating another pod in the 'default_deny' namespace.
    # assert not can_connect_from_pod(pod_name, namespace, other_pod_ip, some_port), \
    #    f"Default deny failed: Pod {pod_name} connected within namespace {namespace}"

    logging.info("Default deny test passed.")


@pytest.mark.parametrize("tester_pod", [NAMESPACES["allow_specific"]], indirect=True)
def test_specific_allow_rules(tester_pod):
    """Verify that specific allow rules permit intended traffic and deny others."""
    pod_name, namespace = tester_pod
    allowed_svc_info = SERVICES["target_allowed"]
    denied_svc_info = SERVICES["target_denied"]

    allowed_host = f"{allowed_svc_info['name']}.{namespace}.svc"
    allowed_port = allowed_svc_info['port']
    denied_host = f"{denied_svc_info['name']}.{namespace}.svc"
    denied_port = denied_svc_info['port']

    logging.info(f"Testing specific allow rules from {pod_name} in {namespace}...")

    # Test connection to the allowed service (should succeed)
    assert can_connect_from_pod(pod_name, namespace, allowed_host, allowed_port), \
        f"Specific allow failed: Pod {pod_name} could not connect to allowed {allowed_host}:{allowed_port}"

    # Test connection to a denied service (should fail)
    assert not can_connect_from_pod(pod_name, namespace, denied_host, denied_port), \
        f"Specific allow failed: Pod {pod_name} connected to denied {denied_host}:{denied_port}"

    logging.info("Specific allow rules test passed.")


@pytest.mark.parametrize("tester_pod", [NAMESPACES["isolated_a"]], indirect=True)
def test_namespace_isolation_a_to_b(tester_pod):
    """Verify that namespace A cannot reach namespace B unless allowed."""
    pod_name, namespace = tester_pod
    target_svc_info = SERVICES["target_iso_b"]
    target_host = f"{target_svc_info['name']}.{target_svc_info['namespace']}.svc"
    target_port = target_svc_info['port']

    logging.info(f"Testing namespace isolation from {namespace} to {target_svc_info['namespace']}...")

    assert not can_connect_from_pod(pod_name, namespace, target_host, target_port), \
        f"Namespace isolation failed: Pod {pod_name} in {namespace} connected to {target_host}:{target_port}"

    logging.info(f"Namespace isolation test ({namespace} -> {target_svc_info['namespace']}) passed.")


@pytest.mark.parametrize("tester_pod", [NAMESPACES["isolated_b"]], indirect=True)
def test_namespace_isolation_b_to_a(tester_pod):
    """Verify that namespace B cannot reach namespace A unless allowed."""
    pod_name, namespace = tester_pod
    target_svc_info = SERVICES["target_iso_a"]
    target_host = f"{target_svc_info['name']}.{target_svc_info['namespace']}.svc"
    target_port = target_svc_info['port']

    logging.info(f"Testing namespace isolation from {namespace} to {target_svc_info['namespace']}...")

    assert not can_connect_from_pod(pod_name, namespace, target_host, target_port), \
        f"Namespace isolation failed: Pod {pod_name} in {namespace} connected to {target_host}:{target_port}"

    logging.info(f"Namespace isolation test ({namespace} -> {target_svc_info['namespace']}) passed.")


@pytest.mark.parametrize("tester_pod", [NAMESPACES["egress_controlled"]], indirect=True)
def test_egress_control(tester_pod):
    """Verify egress policies allow/deny connections to external services."""
    pod_name, namespace = tester_pod
    allowed_host, allowed_port = EXTERNAL_ALLOWED.split(':')
    denied_host, denied_port = EXTERNAL_DENIED.split(':')

    logging.info(f"Testing egress control from {pod_name} in {namespace}...")

    # Test connection to allowed external target (should succeed)
    assert can_connect_from_pod(pod_name, namespace, allowed_host, int(allowed_port)), \
        f"Egress control failed: Pod {pod_name} could not connect to allowed external {EXTERNAL_ALLOWED}"

    # Test connection to denied external target (should fail)
    assert not can_connect_from_pod(pod_name, namespace, denied_host, int(denied_port)), \
        f"Egress control failed: Pod {pod_name} connected to denied external {EXTERNAL_DENIED}"

    logging.info("Egress control test passed.")


# test_policy_precedence requires specific policies to be set up beforehand
# Example: Allow all egress, but deny egress to a specific IP range.
# Then test connections to IPs inside and outside the denied range.
# @pytest.mark.parametrize("tester_pod", [NAMESPACE_FOR_PRECEDENCE_TEST], indirect=True)
# def test_policy_precedence(tester_pod):
#     pod_name, namespace = tester_pod
#     allowed_ip = "1.1.1.1" # Assume allowed by general egress rule
#     denied_ip = "x.x.x.x" # Assume specifically denied by a higher precedence rule
#     port = 80
#
#     assert can_connect_from_pod(pod_name, namespace, allowed_ip, port), "Policy precedence failed: Allowed IP blocked"
#     assert not can_connect_from_pod(pod_name, namespace, denied_ip, port), "Policy precedence failed: Denied IP allowed"


# --- Visualization Notes ---
# To visualize results:
# 1. Collect results from all tests (pass/fail for each connection attempt).
# 2. Represent namespaces and services/pods as nodes in a graph.
# 3. Draw edges representing attempted connections.
# 4. Color edges based on test result (e.g., green for allowed/passed, red for blocked/failed).
# 5. Libraries like NetworkX and Matplotlib/Graphviz could be used.
# This requires storing test results systematically, which is beyond this basic framework.
