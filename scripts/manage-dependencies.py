#!/usr/bin/env python3

"""
Dependency Manager for Homelab Infrastructure

This script helps manage Python dependencies for homelab infrastructure scripts,
handling common issues with dependency resolution and providing consistent
environment setup.
"""

import os
import sys
import subprocess
import argparse
import json
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
REQUIREMENTS = {
    "secure-config": [
        "pyyaml",
        "cryptography",
        "kubernetes",
        "jsonschema"
    ],
    "monitoring": [
        "prometheus-client",
        "python-loki",
        "requests"
    ],
    "all": []  # Will be populated with all dependencies
}

# Populate the "all" category
for deps in REQUIREMENTS.values():
    for dep in deps:
        if dep not in REQUIREMENTS["all"]:
            REQUIREMENTS["all"].append(dep)


def get_installed_packages():
    """Get a list of currently installed packages"""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "list", "--format=json"],
            capture_output=True,
            text=True,
            check=True
        )
        packages = json.loads(result.stdout)
        return {pkg["name"].lower(): pkg["version"] for pkg in packages}
    except Exception as e:
        print(f"Error getting installed packages: {e}")
        return {}


PACKAGE_ALTERNATIVES = {
    "python-loki": ["python-logging-loki", "logging-loki"]
}

def install_dependencies(dependencies, use_uv=True, frozen=True):
    """Install the specified dependencies"""
    if not dependencies:
        print("No dependencies specified")
        return True

    # Try alternative packages for known problematic packages
    fixed_dependencies = []
    for dep in dependencies:
        if dep in PACKAGE_ALTERNATIVES and use_uv and not frozen:
            print(f"Note: {dep} may have alternatives: {', '.join(PACKAGE_ALTERNATIVES[dep])}")
        fixed_dependencies.append(dep)

    print(f"Installing dependencies: {', '.join(fixed_dependencies)}")

    if use_uv:
        cmd = ["uv", "add"]
        if frozen:
            cmd.append("--frozen")
        cmd.extend(fixed_dependencies)
    else:
        cmd = [sys.executable, "-m", "pip", "install"] + fixed_dependencies

    try:
        subprocess.run(cmd, check=True)
        print("Dependencies installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error installing dependencies: {e}")
        if use_uv and not frozen:
            print("\nTrying with --frozen flag...")
            return install_dependencies(dependencies, use_uv=True, frozen=True)
        elif use_uv:
            print("\nTrying with pip instead...")
            return install_dependencies(dependencies, use_uv=False, frozen=False)
        return False


def setup_venv():
    """Set up a virtual environment if not already activated"""
    if not os.environ.get("VIRTUAL_ENV"):
        venv_path = PROJECT_ROOT / ".venv"

        # Check if venv exists
        if not venv_path.exists():
            print(f"Creating virtual environment at {venv_path}")
            try:
                subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)
            except subprocess.CalledProcessError as e:
                print(f"Error creating virtual environment: {e}")
                return False

        # Provide activation instructions
        activate_script = "activate.bat" if sys.platform == "win32" else "activate"
        print("\nVirtual environment not activated. Please activate it with:")
        print(f"    source {venv_path}/bin/{activate_script}")
        print("Then run this script again.")
        return False

    return True


def check_package_registry(package_name):
    """Check if a package exists in PyPI"""
    try:
        result = subprocess.run(
            ["pip", "search", package_name] if sys.version_info < (3, 7) else
            ["pip", "index", "versions", package_name],
            capture_output=True,
            text=True
        )
        return result.returncode == 0
    except Exception:
        # pip search is often unreliable, so default to True
        return True


def validate_dependencies():
    """Validate that all dependencies exist in the package registry"""
    print("Validating dependencies...")
    unknown_packages = []

    for package_set, packages in REQUIREMENTS.items():
        if package_set == "all":
            continue
        for package in packages:
            if not check_package_registry(package):
                unknown_packages.append((package_set, package))

    if unknown_packages:
        print("Warning: The following packages may not exist in PyPI:")
        for package_set, package in unknown_packages:
            print(f"  - {package} (in {package_set} set)")
        print("Installation may fail for these packages.")

    return len(unknown_packages) == 0


def main():
    parser = argparse.ArgumentParser(description="Manage dependencies for homelab infrastructure")

    parser.add_argument("--setup", action="store_true", help="Set up and verify environment")

    subparsers = parser.add_subparsers(dest="command")

    install_parser = subparsers.add_parser("install", help="Install dependencies")
    install_parser.add_argument("package_set", choices=list(REQUIREMENTS.keys()),
                               help="Package set to install")
    install_parser.add_argument("--no-uv", action="store_true", help="Use pip instead of uv")
    install_parser.add_argument("--no-frozen", action="store_true",
                               help="Don't use --frozen flag with uv")

    list_parser = subparsers.add_parser("list", help="List package sets")

    args = parser.parse_args()

    if args.setup or args.command is None:
        if not setup_venv():
            return 1
        print("Environment is set up correctly")
        if args.command is None:
            parser.print_help()
            return 0

    if args.command == "install":
        if not setup_venv():
            return 1

        # Validate dependencies before installation
        validate_dependencies()

        deps = REQUIREMENTS[args.package_set]
        use_uv = not args.no_uv
        frozen = not args.no_frozen

        success = install_dependencies(deps, use_uv, frozen)
        return 0 if success else 1

    elif args.command == "list":
        print("Available package sets:")
        for name, packages in REQUIREMENTS.items():
            print(f"  {name}: {', '.join(packages)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
