import os
import time
import re
import pytest
import testinfra
import testinfra.modules

from tests.utils.prometheus_helper import PrometheusTestHelper

class PrometheusModule(testinfra.modules.Module):
    """Testinfra module for Prometheus metric validation"""
    
    def __init__(self, host):
        super().__init__(host)
        self._helper = PrometheusTestHelper()
    
    @property
    def url(self):
        """Get the Prometheus server URL"""
        return self._helper.prometheus_url
    
    def query(self, query_string):
        """
        Run a PromQL query against Prometheus
        
        Args:
            query_string: PromQL query expression
        
        Returns:
            Query result dict from Prometheus API
        """
        return self._helper.query_prometheus(query_string)
    
    def query_range(self, query_string, start_time, end_time, step="15s"):
        """
        Run a PromQL range query against Prometheus
        
        Args:
            query_string: PromQL query expression
            start_time: Start timestamp in seconds
            end_time: End timestamp in seconds
            step: Step interval (e.g., "15s", "1m")
            
        Returns:
            Query result dict from Prometheus API for the time range
        """
        return self._helper.query_range(query_string, start_time, end_time, step)
    
    def check_metric_exists(self, metric_name):
        """
        Check if a metric exists in Prometheus
        
        Args:
            metric_name: Name of the metric to check
            
        Returns:
            Boolean indicating if the metric exists
        """
        result = self.query(f'{metric_name}')
        return result.get("status") == "success" and len(result.get("data", {}).get("result", [])) > 0
    
    def check_value(self, query_string, operator, threshold):
        """
        Check if a metric meets a threshold condition
        
        Args:
            query_string: PromQL query that returns a single value
            operator: Comparison operator ('>', '<', '>=', '<=', '==', '!=')
            threshold: Threshold value to compare against
            
        Returns:
            Boolean indicating if the condition is met
        """
        return self._helper.check_metric_threshold(query_string, operator, threshold)
    
    def has_pulumi_success(self, project, time_window="1h"):
        """
        Check if Pulumi deployment was successful for a project
        
        Args:
            project: Name of the Pulumi project
            time_window: Time window for the query (e.g., "1h" for 1 hour)
            
        Returns:
            Boolean indicating if the deployment was successful
        """
        query = f'pulumi_deployment_success{{project="{project}"}}[{time_window}]'
        result = self.query(query)
        return result.get("status") == "success" and len(result.get("data", {}).get("result", [])) > 0
    
    def deployment_ready(self, namespace, deployment_name):
        """
        Check if a Kubernetes deployment is ready
        
        Args:
            namespace: Kubernetes namespace
            deployment_name: Name of the deployment
            
        Returns:
            Boolean indicating if the deployment is ready
        """
        query = (
            f'kube_deployment_status_replicas_available{{namespace="{namespace}",'
            f'deployment="{deployment_name}"}} == '
            f'kube_deployment_status_replicas_desired{{namespace="{namespace}",'
            f'deployment="{deployment_name}"}}'
        )
        return self.check_value(query, '==', 1)
    
    def pod_restarts(self, namespace, pod_name_pattern):
        """
        Get the number of pod restarts for pods matching a pattern
        
        Args:
            namespace: Kubernetes namespace
            pod_name_pattern: Regex pattern to match pod names
            
        Returns:
            Number of restarts or -1 if query fails
        """
        query = f'sum(kube_pod_container_status_restarts_total{{namespace="{namespace}",pod=~"{pod_name_pattern}"}})'
        result = self.query(query)
        
        if result.get("status") == "success" and result.get("data", {}).get("result"):
            try:
                return float(result["data"]["result"][0]["value"][1])
            except (KeyError, IndexError, ValueError):
                pass
        return -1
    
    def node_resources(self, node_name):
        """
        Get resource usage for a specific node
        
        Args:
            node_name: Name of the Kubernetes node
            
        Returns:
            Dict with resource usage information
        """
        cpu_query = f'sum(rate(node_cpu_seconds_total{{mode!="idle",instance=~"{node_name}.*"}}[5m]))'
        memory_query = f'node_memory_MemTotal_bytes{{instance=~"{node_name}.*"}} - node_memory_MemAvailable_bytes{{instance=~"{node_name}.*"}}'
        disk_query = f'node_filesystem_size_bytes{{instance=~"{node_name}.*",mountpoint="/"}} - node_filesystem_free_bytes{{instance=~"{node_name}.*",mountpoint="/"}}'
        
        cpu_result = self.query(cpu_query)
        memory_result = self.query(memory_query)
        disk_result = self.query(disk_query)
        
        cpu_value = self._extract_value(cpu_result)
        memory_value = self._extract_value(memory_result)
        disk_value = self._extract_value(disk_result)
        
        return {
            "cpu": cpu_value,
            "memory": memory_value,
            "disk": disk_value
        }
    
    def _extract_value(self, query_result):
        """Extract a numeric value from a Prometheus query result"""
        if query_result.get("status") == "success" and query_result.get("data", {}).get("result"):
            try:
                return float(query_result["data"]["result"][0]["value"][1])
            except (KeyError, IndexError, ValueError):
                pass
        return None


# Register the module
testinfra.modules.PrometheusModule = PrometheusModule
