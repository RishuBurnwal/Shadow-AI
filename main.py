"""Single Windows-friendly launcher for Shadow AI."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
READY_MARKER = "shadow-ai-ready"
STARTUP_TIMEOUT = 60  # first-run model and native-runtime startup can be slow

RESET = "\033[0m"
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"


def enable_terminal_colors() -> None:
    if os.name == "nt":
        os.system("")  # Enables ANSI processing in modern Windows terminals.


def banner(title: str, subtitle: str = "") -> None:
    width = 62
    print(f"\n{CYAN}+{'-' * width}+")
    print(f"|{BOLD}{title:^{width}}{RESET}{CYAN}|")
    if subtitle:
        print(f"|{subtitle:^{width}}|")
    print(f"+{'-' * width}+{RESET}")


def step(index: int, total: int, text: str) -> None:
    print(f"{CYAN}[{index}/{total}]{RESET} {text}", flush=True)


def success(text: str) -> None:
    print(f"{GREEN}[OK]{RESET} {text}")


def cleanup_old_logs() -> None:
    """Remove all but the 5 most recent launcher log files."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        logs = sorted(LOG_DIR.glob("launcher-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in logs[5:]:
            old.unlink(missing_ok=True)
    except OSError:
        pass


def clear_readiness_marker() -> None:
    marker = ROOT / READY_MARKER
    try:
        if marker.exists():
            marker.unlink()
    except OSError:
        pass


def wait_for_readiness() -> bool:
    """Poll for the readiness marker file written by src/index.js on successful window creation."""
    marker = ROOT / READY_MARKER
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        if marker.exists():
            try:
                marker.unlink()
            except OSError:
                pass
            return True
        time.sleep(0.3)
    return False


PROVIDERS = {
    "groq": "GROQ_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "perplexity": "PERPLEXITY_API_KEY",
    "nvidia": "NVIDIA_API_KEY",
    "gemini": "GEMINI_API_KEY",
}
REQUIRED_FILES = (
    "package.json",
    "package-lock.json",
    "forge.config.js",
    "src/index.js",
    "src/index.html",
    "src/assets/logo.png",
)
MINIMUM_NODE_MAJOR = 18
UPDATE_REPOSITORY = "https://github.com/RishuBurnwal/Shadow-AI.git"
UPDATE_BRANCH = "main"
SILENT_MODE_ENV = "SHADOW_AI_SILENT"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key.replace("_", "").isalnum():
            os.environ.setdefault(key, value)


def configured_providers() -> list[str]:
    return [name for name, env_key in PROVIDERS.items() if os.environ.get(env_key, "").strip()]


def silent_mode_enabled() -> bool:
    value = os.environ.get(SILENT_MODE_ENV, "false").strip().lower()
    if value not in {"true", "false"}:
        print(f"WARNING: {SILENT_MODE_ENV} must be true or false; using false.", file=sys.stderr)
        return False
    return value == "true"


def npm_command() -> str:
    command = "npm.cmd" if os.name == "nt" else "npm"
    if not shutil.which(command):
        raise RuntimeError("npm was not found on PATH. Install Node.js first.")
    return command


def command_output(command: list[str]) -> str:
    completed = subprocess.run(command, cwd=ROOT, check=False, capture_output=True, text=True)
    if completed.returncode:
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(detail or f"Command failed: {' '.join(command)}")
    return completed.stdout.strip()


def ensure_env_file() -> str:
    env_path = ROOT / ".env"
    if env_path.exists():
        return "preserved"
    example_path = ROOT / ".env.example"
    if not example_path.exists():
        raise RuntimeError(".env.example is missing")
    shutil.copyfile(example_path, env_path)
    return "created from .env.example"


def validate_project_files() -> None:
    missing = [relative for relative in REQUIRED_FILES if not (ROOT / relative).exists()]
    if missing:
        raise RuntimeError("Required project files are missing: " + ", ".join(missing))


def run_npm_task(arguments: list[str], label: str) -> int:
    try:
        validate_project_files()
        npm = npm_command()
        print(label, flush=True)
        return subprocess.run([npm, *arguments], cwd=ROOT, check=False).returncode
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


def show_provider_status() -> int:
    load_env(ROOT / ".env")
    available = configured_providers()
    print("\nAPI provider status")
    for index, name in enumerate(PROVIDERS, start=1):
        print(f"  {index}. {name:<10} {'configured' if name in available else 'missing'}")
    return 0


def menu_args(provider: str = "auto", *, info: bool = False, skip_install: bool = False, skip_update: bool = False) -> argparse.Namespace:
    return argparse.Namespace(
        setup=False,
        provider=provider,
        providers=False,
        info=info,
        skip_install=skip_install,
        skip_update=skip_update,
        wait=False,
    )


def choose_provider() -> str | None:
    load_env(ROOT / ".env")
    available = configured_providers()
    if not available:
        print("No configured API providers. Add a key in .env or through the application UI.")
        return None
    print("\nSelect API provider")
    print("  0. Back")
    for index, provider in enumerate(available, start=1):
        print(f"  {index}. {provider}")
    selection = input("Choose provider number: ").strip()
    if selection == "0":
        return None
    if not selection.isdigit() or not 1 <= int(selection) <= len(available):
        print("Invalid provider selection.")
        return None
    return available[int(selection) - 1]


def git_output(arguments: list[str]) -> str:
    git = shutil.which("git")
    if not git:
        raise RuntimeError("Git was not found on PATH. Install Git, then try the update again.")
    return command_output([git, *arguments])


def stop_running_project() -> None:
    if os.name == "nt":
        escaped_root = str(ROOT).replace("'", "''")
        script = (
            "$root='" + escaped_root + "'; "
            "$processes=Get-CimInstance Win32_Process | Where-Object { "
            "($_.Name -match '^(electron|node)\\.exe$') -and $_.CommandLine -and $_.CommandLine.Contains($root) }; "
            "$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], cwd=ROOT, check=False)


def repository_matches_expected_remote(remote_url: str) -> bool:
    normalized = remote_url.strip().lower().replace("\\", "/")
    normalized = normalized.removesuffix("/").removesuffix(".git")
    expected = UPDATE_REPOSITORY.lower().removesuffix(".git")
    return normalized == expected or normalized.endswith("github.com:rishuburnwal/shadow-ai")


def update_project(*, restart: bool = True, quiet_current: bool = False, skip_if_dirty: bool = False) -> int:
    banner("SHADOW AI UPDATER", "verified fast-forward updates")
    try:
        if not (ROOT / ".git").exists():
            raise RuntimeError("This project is not a Git checkout. Clone the GitHub repository before using updates.")
        remote_url = git_output(["remote", "get-url", "origin"])
        if not repository_matches_expected_remote(remote_url):
            raise RuntimeError("Origin does not point to the official Shadow AI update repository.")
        dirty = git_output(["status", "--porcelain", "--untracked-files=no"])
        if dirty:
            if skip_if_dirty:
                print("Local changes detected; skipping auto-update and launching the working copy.")
                return 0
            raise RuntimeError("Local tracked files have uncommitted changes. Commit or restore them before updating.")

        local_hash = git_output(["rev-parse", "HEAD"])
        print(f"  Local  {local_hash[:12]}")
        print("  Checking official GitHub remote...", flush=True)
        git = shutil.which("git")
        completed = subprocess.run([git, "fetch", "origin", UPDATE_BRANCH, "--prune"], cwd=ROOT, check=False)
        if completed.returncode:
            return completed.returncode
        remote_hash = git_output(["rev-parse", f"origin/{UPDATE_BRANCH}"])
        print(f"  Remote {remote_hash[:12]}")
        if local_hash == remote_hash:
            if not quiet_current:
                success("Project is already up to date")
            return 0

        changed_files = [line for line in git_output(["diff", "--name-only", local_hash, remote_hash]).splitlines() if line]
        print(f"Update found: {len(changed_files)} changed file(s).")
        for file_name in changed_files[:20]:
            print(f"  - {file_name}")
        if len(changed_files) > 20:
            print(f"  ... and {len(changed_files) - 20} more")

        stop_running_project()
        completed = subprocess.run([git, "merge", "--ff-only", f"origin/{UPDATE_BRANCH}"], cwd=ROOT, check=False)
        if completed.returncode:
            return completed.returncode

        # Prove every tracked file now exactly matches the fetched commit.
        if git_output(["diff", "--name-only", f"origin/{UPDATE_BRANCH}"]):
            raise RuntimeError("Post-update file verification failed: local files do not match GitHub.")
        if git_output(["rev-parse", "HEAD"]) != remote_hash:
            raise RuntimeError("Post-update commit hash verification failed.")

        npm = npm_command()
        for arguments, label in (
            (["ci"], "Installing exact lockfile dependencies..."),
            (["run", "package"], "Rebuilding Shadow AI..."),
        ):
            print(label, flush=True)
            completed = subprocess.run([npm, *arguments], cwd=ROOT, check=False)
            if completed.returncode:
                print("Update downloaded, but validation/build failed. Application was not restarted.", file=sys.stderr)
                return completed.returncode

        success("Every tracked file and dependency verified")
        if restart:
            print("Restarting Shadow AI...", flush=True)
            return launch(menu_args(skip_install=True, skip_update=True))
        return 0
    except RuntimeError as error:
        print(f"UPDATE ERROR: {error}", file=sys.stderr)
        return 2


def interactive_menu() -> int:
    banner("SHADOW AI", "secure desktop assistant control center")
    print(f"  {GREEN}1{RESET}  >  Run project (auto-update + repair)")
    print(f"  {GREEN}2{RESET}  *  One-click complete installation")
    print(f"  {GREEN}3{RESET}  v  Reinstall exact dependencies")
    print(f"  {GREEN}4{RESET}  #  Build application package")
    print(f"  {GREEN}5{RESET}  @  Verify and update from GitHub")
    print(f"  {GREEN}6{RESET}  o  Select provider and launch")
    print(f"  {GREEN}7{RESET}  .  Provider status")
    print(f"  {GREEN}8{RESET}  i  System diagnostics")
    print(f"  {YELLOW}0{RESET}  x  Exit")
    selection = input(f"\n{CYAN}shadow-ai >{RESET} ").strip() or "1"

    if selection == "0":
        print("Goodbye.")
        return 0
    if selection == "1":
        return launch(menu_args())
    if selection == "2":
        return setup_project(menu_args())
    if selection == "3":
        ensure_env_file()
        return run_npm_task(["ci"], "Installing exact lockfile dependencies...")
    if selection == "4":
        return run_npm_task(["run", "package"], "Building Shadow AI package...")
    if selection == "5":
        return update_project()
    if selection == "6":
        provider = choose_provider()
        return launch(menu_args(provider)) if provider else 0
    if selection == "7":
        return show_provider_status()
    if selection == "8":
        return launch(menu_args(info=True))
    print("Invalid option. Run python main.py and choose a number from 0 to 8.")
    return 2


def setup_project(args: argparse.Namespace) -> int:
    banner("ONE-CLICK INSTALL", str(ROOT))
    try:
        validate_project_files()
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js was not found on PATH. Install Node.js 18 or newer, then run --setup again.")
        node_version = command_output([node, "--version"])
        try:
            node_major = int(node_version.lstrip("v").split(".", 1)[0])
        except ValueError as error:
            raise RuntimeError(f"Unable to read Node.js version: {node_version}") from error
        if node_major < MINIMUM_NODE_MAJOR:
            raise RuntimeError(f"Node.js {MINIMUM_NODE_MAJOR}+ is required; found {node_version}.")

        npm = npm_command()
        npm_version = command_output([npm, "--version"])
        git_version = git_output(["--version"])
        step(1, 5, f"Runtime: Python {sys.version_info.major}.{sys.version_info.minor} · Node {node_version} · npm {npm_version} · {git_version}")
        step(2, 5, f"Environment: .env {ensure_env_file()}")

        if args.skip_install:
            if not (ROOT / "node_modules" / "electron").exists():
                raise RuntimeError("--skip-install was used but Electron dependencies are missing.")
            step(3, 5, "Dependencies: existing Electron runtime found")
        else:
            step(3, 5, "Installing exact package-lock dependencies with npm ci")
            completed = subprocess.run([npm, "ci"], cwd=ROOT, check=False)
            if completed.returncode:
                return completed.returncode

        step(4, 5, "Verifying installed dependency tree")
        completed = subprocess.run([npm, "ls", "--depth=0"], cwd=ROOT, check=False)
        if completed.returncode:
            return completed.returncode

        step(5, 5, "Building Electron application package")
        completed = subprocess.run([npm, "run", "package"], cwd=ROOT, check=False)
        if completed.returncode:
            return completed.returncode

        load_env(ROOT / ".env")
        available = configured_providers()
        success("Installation, dependency verification and package complete")
        print("configured providers: " + (", ".join(available) if available else "none"))
        if not available:
            print("Next: add at least one API key in .env or through the Shadow AI UI.")
        print("Launch: run python main.py and press Enter, or choose menu option 6 for a specific provider.")
        return 0
    except RuntimeError as error:
        print(f"SETUP ERROR: {error}", file=sys.stderr)
        return 2


def launch(args: argparse.Namespace) -> int:
    load_env(ROOT / ".env")
    if args.setup:
        return setup_project(args)
    available = configured_providers()
    if args.providers:
        for name in PROVIDERS:
            print(f"{name}: {'configured' if name in available else 'missing'}")
        return 0

    if not available:
        print("ERROR: No API key found. Copy .env.example to .env and configure at least one provider.", file=sys.stderr)
        return 2
    if args.provider != "auto" and args.provider not in available:
        print(f"ERROR: {args.provider} is selected but its API key is missing.", file=sys.stderr)
        return 2

    os.environ["SHADOW_AI_PROVIDER"] = args.provider
    if args.info:
        print("Shadow AI launcher")
        print(f"provider: {args.provider}")
        print("configured: " + ", ".join(available))
        print(f"project: {ROOT}")
        print(f"debug: {'enabled' if os.environ.get('SHADOW_AI_DEBUG') else 'disabled (set SHADOW_AI_DEBUG=1)'}")
        print(f"whisper backend: logged in app console on local mode startup")
        return 0

    if not args.skip_update:
        update_status = update_project(restart=False, quiet_current=True, skip_if_dirty=True)
        if update_status:
            return update_status

    npm = npm_command()
    if not args.skip_install and not (ROOT / "node_modules" / "electron").exists():
        completed = subprocess.run([npm, "install"], cwd=ROOT, check=False)
        if completed.returncode:
            return completed.returncode

    command = [npm, "start"]
    if os.name == "nt":
        command = ["cmd.exe", "/d", "/c", "call", npm, "start"]
    launch_env = os.environ.copy()
    launch_env.pop("ELECTRON_RUN_AS_NODE", None)
    if args.wait:
        return subprocess.run(command, cwd=ROOT, check=False, env=launch_env).returncode

    silent = silent_mode_enabled()
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NO_WINDOW if silent else subprocess.CREATE_NEW_CONSOLE

    # Always redirect stderr to a rotating log file so startup errors are never lost
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"launcher-{time.strftime('%Y%m%d-%H%M%S')}.log"
    stderr_target = open(log_path, "a", encoding="utf-8")

    # Write a header so we can tell when a new launch begins
    stderr_target.write(f"\n{'='*60}\nLaunch at {time.strftime('%Y-%m-%d %H:%M:%S')}\n{'='*60}\n")
    stderr_target.flush()

    # Clean up old logs (keep last 5)
    cleanup_old_logs()

    # Clear any stale readiness marker from a previous run
    clear_readiness_marker()

    subprocess.Popen(
        command,
        cwd=ROOT,
        env={**launch_env, "SHADOW_AI_READY_MARKER": str(ROOT / READY_MARKER)},
        creationflags=creationflags,
        stdout=subprocess.DEVNULL if silent else None,
        stderr=stderr_target,
    )

    # Wait for the Electron app to signal readiness (up to STARTUP_TIMEOUT seconds)
    ready = wait_for_readiness()
    if ready:
        print(f"Shadow AI started ({'silent' if silent else 'visible terminal'} mode)")
        return 0
    else:
        # Check if the process already exited (fast-fail)
        print("ERROR: Shadow AI did not start successfully.", file=sys.stderr)
        print(f"       Check the log file for details: {log_path}", file=sys.stderr)
        return 1


def build_parser() -> argparse.ArgumentParser:
    available = configured_providers()
    requested_default = os.environ.get("SHADOW_AI_PROVIDER", "auto").lower()
    default_provider = requested_default if requested_default in available else "auto"
    parser = argparse.ArgumentParser(description="Launch the complete Shadow AI Electron application")
    parser.add_argument(
        "--setup",
        action="store_true",
        help="complete setup: create .env, install dependencies and build the Electron package",
    )
    parser.add_argument(
        "--provider",
        choices=["auto", *available],
        default=default_provider,
        help="preferred provider; only providers configured in .env are selectable (default: %(default)s)",
    )
    parser.add_argument("--providers", action="store_true", help="show configured providers without revealing keys")
    parser.add_argument("--info", action="store_true", help="show safe launcher diagnostics")
    parser.add_argument("--skip-install", action="store_true", help="reuse installed dependencies during launch or setup")
    parser.add_argument("--skip-update", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--wait", action="store_true", help="keep the launcher attached to Electron")
    return parser


if __name__ == "__main__":
    enable_terminal_colors()
    load_env(ROOT / ".env")
    if len(sys.argv) == 1:
        raise SystemExit(interactive_menu())
    raise SystemExit(launch(build_parser().parse_args()))
