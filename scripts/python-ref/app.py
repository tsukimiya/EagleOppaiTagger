"""
Oppai ONNX tagger — single-file launcher.

First run: creates `.venv/`, installs requirements, re-execs inside the venv,
then starts a local Gradio web UI on http://127.0.0.1:7860 .

If the user has no Python at all, `run.bat` instead drops a portable Python
into `.pyenv/` and uses that. In that case `app.py` skips venv creation and
installs requirements directly into the portable Python's site-packages.

Subsequent runs: skip install (marker file) and start the UI immediately.

For most users:
    Just run `run.bat` (or `py app.py`). The launcher will show a numbered
    menu so you can pick an existing model or download one — no flags
    required. Press Enter to accept the highlighted default at any prompt.

Advanced flags:
    py app.py --reinstall              # force re-install of requirements
    py app.py --model-dir <folder>     # skip the menu, load a specific folder

Models live in folders next to this script. Any folder containing
`model.onnx`, `selected_tags.csv`, and `preprocessing.json` is treated as a
model and will appear in the launcher menu and the UI's model picker. You
can also download variants from https://huggingface.co/Grio43/OppaiOracle
directly from the menu or from the UI.
"""

from __future__ import annotations

import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
MARKER = VENV_DIR / ".bootstrapped"

# Portable Python lives here when run.bat had to download one because no
# system Python was available. When app.py is launched by .pyenv/python.exe,
# we install requirements directly into that interpreter — no venv needed.
PYENV_DIR = ROOT / ".pyenv"
PYENV_MARKER = PYENV_DIR / ".bootstrapped"

# Microsoft Visual C++ 2015-2022 redistributable (x64). onnxruntime's native
# DLLs depend on this; if it's missing the import fails with
# "DLL load failed while importing onnxruntime_pybind11_state".
VC_REDIST_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe"

# Last onnxruntime release that ships AVX-only (no-AVX2) wheels. ORT >= 1.18
# requires AVX2; on older CPUs the import fails with the same generic
# "DLL load failed" message as a missing VC++ runtime. We pin to this version
# as an automatic fallback when AVX2 is not detected.
ORT_NO_AVX2_FALLBACK_VERSION = "1.17.3"

# Default folder if it exists; otherwise the first auto-discovered folder
# next to this script is used. Override with --model-dir or the UI picker.
DEFAULT_MODEL_DIR = ROOT / "V1.1_onnx"

# Variants published on HuggingFace that are usable with this ONNX runtime.
# First entry is the recommended default in interactive prompts.
HF_REPO_ID = "Grio43/OppaiOracle"
HF_VARIANTS = ["V1.1_onnx", "V1_onnx"]
HF_VARIANT_DESC = {
    "V1.1_onnx": "448×448, higher accuracy",
    "V1_onnx":   "320×320, smaller and faster",
}

REQUIREMENTS = [
    "onnxruntime>=1.20",
    "pillow>=10.0",
    "numpy>=1.26,<3",
    "gradio>=4.44",
    "huggingface_hub>=0.24",
]


# ---------------------------------------------------------------------------
# Setup helpers (pre-flight checks, friendlier install, post-install verify)
#
# These are called from _bootstrap / _bootstrap_portable below. They depend
# on the platform/runtime checks defined later in this file (_has_vcruntime,
# _has_avx2, _install_vcredist_with_uac) — Python resolves those at call
# time, so definition order doesn't matter.
# ---------------------------------------------------------------------------

def _check_internet(timeout: float = 4.0) -> bool:
    """Cheap reachability probe for pypi.org.

    Conservative on unknown errors: only a clean URLError (no DNS, refused,
    timeout) returns False. We don't want a flaky probe to falsely block
    setup when the real install would have worked."""
    try:
        import urllib.error
        import urllib.request
        urllib.request.urlopen("https://pypi.org/simple/", timeout=timeout)
        return True
    except urllib.error.URLError:
        return False
    except Exception:  # noqa: BLE001
        return True


def _friendly_pip_install(py: Path, packages: list[str], action: str) -> None:
    """Run `pip install` and translate non-zero exits into actionable hints.

    pip prints its own error output, so we add a one-line summary plus a
    short list of common fixes — enough for a non-tech user to unblock
    themselves without reading a stack trace."""
    cmd = [str(py), "-m", "pip", "install", *packages]
    try:
        rc = subprocess.call(cmd)
    except KeyboardInterrupt:
        print("\n[setup] Cancelled by user.")
        sys.exit(130)
    if rc == 0:
        return
    print()
    print(f"[setup] Failed to {action} (pip exit code {rc}).")
    print("Common fixes:")
    print("  - Check your internet connection (corporate proxy/VPN can block pypi.org)")
    print("  - Make sure you have at least ~600 MB of free disk space")
    print("  - Run this script from a folder you own (Desktop/Documents) so pip can write")
    print("  - Once the issue is fixed, re-run with --reinstall to retry")
    sys.exit(1)


def _requirements_for_this_cpu() -> list[str]:
    """Return REQUIREMENTS adjusted for this CPU.

    On non-AVX2 CPUs, pin onnxruntime up front to the last AVX-only release
    so the install matches what the loader will accept — instead of pulling
    a modern wheel pip is happy with but the import will reject."""
    if not _has_avx2():
        print(
            "[setup] This CPU lacks AVX2 — pinning onnxruntime to "
            f"{ORT_NO_AVX2_FALLBACK_VERSION} (last release with AVX-only wheels)."
        )
        return [
            f"onnxruntime=={ORT_NO_AVX2_FALLBACK_VERSION}" if r.startswith("onnxruntime") else r
            for r in REQUIREMENTS
        ]
    return list(REQUIREMENTS)


def _pre_install_environment_setup() -> None:
    """Catch known-broken environments before we spend ~2 minutes on pip.

    Verifies pypi.org is reachable and (on Windows) installs the VC++
    runtime up front when missing. Doing this here saves the user from a
    confusing install -> launch -> crash -> install -> launch dance, since
    a missing VC++ runtime would otherwise only surface when onnxruntime is
    first imported."""
    if not _check_internet():
        print("[setup] Could not reach https://pypi.org/.")
        print("        Check your internet connection, then re-run this script.")
        print("        If you're behind a corporate proxy, set HTTPS_PROXY first, e.g.")
        print("            set HTTPS_PROXY=http://proxy.example.com:8080")
        sys.exit(1)

    if os.name == "nt" and not _has_vcruntime():
        print("[setup] Microsoft Visual C++ runtime is missing — installing it now.")
        print("        (one-time, ~25 MB; please accept the UAC prompt that appears)")
        if not _install_vcredist_with_uac():
            print("[setup] Could not install the VC++ runtime automatically.")
            print(f"        Download it from {VC_REDIST_URL}, run it manually,")
            print("        then re-run this script.")
            sys.exit(1)


def _verify_onnxruntime_loads(py: Path) -> tuple[bool, str]:
    """Spawn `<py> -c 'import onnxruntime'` and report whether it succeeded.

    A clean pip install does not guarantee the wheel will load: missing
    vcruntime140_1.dll, antivirus quarantine of onnxruntime_pybind11_state.pyd,
    and 32/64-bit Python mismatches all manifest only at first import.
    Probing here lets the bootstrap recover before writing the success
    marker, so the user only sees one set of progress messages."""
    code = (
        "import sys\n"
        "try:\n"
        "    import onnxruntime  # noqa: F401\n"
        "except BaseException as e:\n"
        "    sys.stderr.write(repr(e))\n"
        "    sys.exit(1)\n"
    )
    try:
        proc = subprocess.run(
            [str(py), "-c", code], check=False, capture_output=True, text=True
        )
    except OSError as e:
        return False, str(e)
    if proc.returncode == 0:
        return True, ""
    return False, (proc.stderr or "").strip() or "unknown import failure"


def _bootstrap_recover(py: Path, err_repr: str) -> bool:
    """Single-shot recovery for a failing onnxruntime import during setup.

    Mirrors the in-app recovery in _recover_after_onnxruntime_load_failure
    but stays in the setup stage (no re-exec), so the caller can re-run the
    verification probe and only mark the install good once it actually works.
    Returns True if a recovery action was attempted."""
    if os.name != "nt":
        return False
    if "DLL load failed" not in err_repr and "ImportError" not in err_repr:
        return False
    if not _has_vcruntime():
        print("[setup] VC++ runtime still missing — retrying installer.")
        return _install_vcredist_with_uac()
    if not _has_avx2():
        print(
            "[setup] CPU lacks AVX2 — reinstalling onnxruntime "
            f"{ORT_NO_AVX2_FALLBACK_VERSION} ..."
        )
        try:
            subprocess.check_call(
                [str(py), "-m", "pip", "install", "--force-reinstall",
                 f"onnxruntime=={ORT_NO_AVX2_FALLBACK_VERSION}"]
            )
            return True
        except subprocess.CalledProcessError:
            return False
    return False


def _finalize_install(py: Path, marker_path: Path) -> None:
    """Verify onnxruntime imports, run one round of recovery if needed, then
    write the success marker. Exits with a tailored diagnostic if recovery
    can't make the import work."""
    print("[setup] Verifying onnxruntime can load ...")
    ok, err = _verify_onnxruntime_loads(py)
    if not ok:
        print(f"[setup] Initial import failed: {err}")
        if _bootstrap_recover(py, err):
            ok, err = _verify_onnxruntime_loads(py)
    if not ok:
        print()
        print("[setup] onnxruntime still fails to load.")
        print(f"        Last error: {err}")
        print("Likely causes:")
        print("  - Antivirus quarantined onnxruntime_pybind11_state.pyd")
        print("    (open Windows Defender's Protection History and restore it)")
        print("  - Corrupt install — re-run this script with --reinstall")
        print("  - 32-bit Python loading 64-bit wheels (or vice versa)")
        sys.exit(1)
    marker_path.write_text("ok\n", encoding="utf-8")
    print("[setup] Done.")


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

def _venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def _in_target_venv() -> bool:
    # Belt-and-suspenders: compare both sys.executable and sys.prefix against
    # the target venv. Windows Store Python uses reparse points that can make
    # Path.resolve() on sys.executable return a path that differs from the
    # venv's python.exe even when running inside it; sys.prefix is more
    # reliable for that case. Either match counts as "in venv".
    try:
        target_py = _venv_python().resolve()
    except OSError:
        target_py = None
    try:
        target_dir = VENV_DIR.resolve()
    except OSError:
        target_dir = None
    try:
        if target_py is not None and Path(sys.executable).resolve() == target_py:
            return True
    except OSError:
        pass
    try:
        if target_dir is not None and Path(sys.prefix).resolve() == target_dir:
            return True
    except OSError:
        pass
    return False


def _bootstrap(force_reinstall: bool) -> None:
    needs_install = force_reinstall or not VENV_DIR.exists() or not MARKER.exists()
    if needs_install:
        _pre_install_environment_setup()

    if not VENV_DIR.exists():
        print(f"[setup] Creating Python environment in {VENV_DIR.name}/ ...")
        try:
            venv.EnvBuilder(with_pip=True, clear=False, upgrade_deps=False).create(VENV_DIR)
        except Exception as e:  # noqa: BLE001
            print(f"[setup] Could not create virtualenv: {e}")
            print("        Try running this script from a folder you own (Desktop/Documents).")
            sys.exit(1)

    py = _venv_python()
    if needs_install:
        print("[setup] Upgrading pip ...")
        _friendly_pip_install(py, ["--upgrade", "pip"], "upgrade pip")
        reqs = _requirements_for_this_cpu()
        print("[setup] Installing dependencies (~500 MB, takes ~1-3 minutes) ...")
        _friendly_pip_install(py, reqs, "install required packages")
        _finalize_install(py, MARKER)
        print("[setup] Launching the app.\n")
    else:
        print("[setup] Environment ready (delete .venv/.bootstrapped to re-run setup).")

    args = [a for a in sys.argv[1:] if a != "--reinstall"]
    sys.exit(subprocess.call([str(py), str(Path(__file__).resolve()), *args]))


# ---------------------------------------------------------------------------
# Portable-Python bootstrap (run.bat path when no system Python exists)
# ---------------------------------------------------------------------------

def _running_portable_python() -> bool:
    """True when sys.executable lives inside ROOT/.pyenv/."""
    try:
        return Path(sys.executable).resolve().parent == PYENV_DIR.resolve()
    except OSError:
        return False


def _bootstrap_portable(force_reinstall: bool) -> None:
    """Install pip + requirements directly into the embedded Python.

    Embeddable Python ships without pip and disables `import site` by default,
    so we fix both before pip-installing the rest. No re-exec is needed —
    we're already running inside the target interpreter.
    """
    py = Path(sys.executable)
    needs_install = force_reinstall or not PYENV_MARKER.exists()

    if needs_install:
        _pre_install_environment_setup()

    # 1) Enable site-packages by uncommenting `import site` in pythonXY._pth.
    pth_files = sorted(py.parent.glob("python*._pth"))
    for pth in pth_files:
        try:
            text = pth.read_text(encoding="utf-8")
        except OSError:
            continue
        new_text = text
        for needle in ("#import site", "# import site"):
            if needle in new_text:
                new_text = new_text.replace(needle, "import site")
        if new_text != text:
            try:
                pth.write_text(new_text, encoding="utf-8")
                print(f"[setup] Enabled site-packages in {pth.name}.")
            except OSError as e:
                print(f"[setup] Could not edit {pth}: {e}")

    # 2) Install pip if missing.
    has_pip = subprocess.call(
        [str(py), "-m", "pip", "--version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ) == 0
    if not has_pip:
        print("[setup] Installing pip into portable Python ...")
        import urllib.request
        getpip = py.parent / "_get-pip.py"
        try:
            try:
                urllib.request.urlretrieve("https://bootstrap.pypa.io/get-pip.py", getpip)
            except Exception as e:  # noqa: BLE001
                print(f"[setup] Could not download get-pip.py: {e}")
                print("        Check your internet connection, then re-run this script.")
                sys.exit(1)
            try:
                subprocess.check_call([str(py), str(getpip), "--no-warn-script-location"])
            except subprocess.CalledProcessError:
                print("[setup] get-pip.py failed. Try deleting .pyenv\\ and re-running.")
                sys.exit(1)
        finally:
            try:
                getpip.unlink()
            except OSError:
                pass

    # 3) Install requirements (skipped if marker says we already did it).
    if needs_install:
        print("[setup] Upgrading pip ...")
        _friendly_pip_install(py, ["--upgrade", "pip"], "upgrade pip")
        reqs = _requirements_for_this_cpu()
        print("[setup] Installing dependencies (~500 MB, takes ~1-3 minutes) ...")
        _friendly_pip_install(py, reqs, "install required packages")
        _finalize_install(py, PYENV_MARKER)
    else:
        print("[setup] Environment ready (delete .pyenv\\.bootstrapped to re-run setup).")


# ---------------------------------------------------------------------------
# onnxruntime / Visual C++ runtime / AVX2 recovery
# ---------------------------------------------------------------------------

# Tracks which automatic recoveries have already run, propagated to re-execs
# via the environment so we don't loop forever if a fix doesn't actually fix
# things (e.g. UAC accepted but the install silently failed).
_RECOVERY_ATTEMPTS_VAR = "_OPPAI_RECOVERY_ATTEMPTS"


def _looks_like_native_load_failure(err: BaseException) -> bool:
    """Heuristic: did onnxruntime fail at native-DLL load time? Both a
    missing VC++ runtime and a missing AVX2 instruction set produce the same
    "DLL load failed while importing onnxruntime_pybind11_state" message, so
    we leave it to _recover_after_onnxruntime_load_failure to tell them apart."""
    if os.name != "nt":
        return False
    msg = str(err)
    return "DLL load failed" in msg and "onnxruntime_pybind11_state" in msg


def _has_vcruntime() -> bool:
    """True if the VC++ 2015-2022 runtime DLLs are present in System32. We
    look at vcruntime140.dll, vcruntime140_1.dll, and msvcp140.dll because
    onnxruntime's native code links against all three — vcruntime140_1.dll
    in particular ships the SEH unwinding helpers used by C++ exceptions on
    x64, and a host with the older 14.0 runtime but no _1.dll still fails to
    load with the same generic "DLL load failed" message."""
    if os.name != "nt":
        return True
    sys32 = Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32"
    return (
        (sys32 / "vcruntime140.dll").exists()
        and (sys32 / "vcruntime140_1.dll").exists()
        and (sys32 / "msvcp140.dll").exists()
    )


def _has_avx2() -> bool:
    """True if the OS reports AVX2 support via IsProcessorFeaturePresent
    (PF_AVX2_INSTRUCTIONS_AVAILABLE = 40). Conservative on error: returns
    True if the API can't be called, so we don't downgrade ORT spuriously."""
    if os.name != "nt":
        return True
    try:
        import ctypes
        return bool(ctypes.windll.kernel32.IsProcessorFeaturePresent(40))
    except OSError:
        return True


def _onnxruntime_version() -> str | None:
    try:
        import importlib.metadata as md
        return md.version("onnxruntime")
    except Exception:  # noqa: BLE001
        return None


def _recovery_attempted(name: str) -> bool:
    return name in os.environ.get(_RECOVERY_ATTEMPTS_VAR, "").split(",")


def _mark_recovery_attempted(name: str) -> None:
    cur = [p for p in os.environ.get(_RECOVERY_ATTEMPTS_VAR, "").split(",") if p]
    if name not in cur:
        cur.append(name)
    os.environ[_RECOVERY_ATTEMPTS_VAR] = ",".join(cur)


def _install_vcredist_with_uac() -> bool:
    """Download vc_redist.x64.exe and run it elevated. Returns True on
    apparent success (exit 0 or 3010 = success-pending-reboot)."""
    if os.name != "nt":
        return False
    import urllib.request
    dest = ROOT / ".vc_redist.x64.exe"
    print(f"[runtime] Downloading {VC_REDIST_URL} ...")
    try:
        urllib.request.urlretrieve(VC_REDIST_URL, dest)
    except Exception as e:  # noqa: BLE001
        print(f"[runtime] Download failed: {e}")
        return False

    # Start-Process -Verb RunAs is what triggers the UAC prompt; -Wait blocks
    # until the installer exits so we can read its exit code. Apostrophes in
    # the path are escaped by doubling for PowerShell's single-quote syntax.
    ps_dest = str(dest).replace("'", "''")
    ps_cmd = (
        "$ErrorActionPreference='Stop';"
        f"$p = Start-Process -FilePath '{ps_dest}' "
        "-ArgumentList '/install','/quiet','/norestart' "
        "-Verb RunAs -Wait -PassThru;"
        "exit $p.ExitCode"
    )
    print("[runtime] Launching installer — accept the UAC prompt to continue.")
    try:
        rc = subprocess.call(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd]
        )
    except OSError as e:
        print(f"[runtime] Could not launch installer: {e}")
        rc = -1
    finally:
        try:
            dest.unlink()
        except OSError:
            pass

    if rc in (0, 3010):
        if rc == 3010:
            print("[runtime] Install succeeded but Windows requested a reboot.")
        return True
    if rc == 1602 or rc == 1223:
        print("[runtime] Install was cancelled at the UAC prompt.")
    else:
        print(f"[runtime] Installer exited with code {rc}.")
    return False


def _downgrade_onnxruntime_for_no_avx2() -> bool:
    """Force-reinstall onnxruntime at the last AVX-only release into the
    current interpreter. Returns True on apparent pip success."""
    target = f"onnxruntime=={ORT_NO_AVX2_FALLBACK_VERSION}"
    print(f"[runtime] Reinstalling {target} (this CPU lacks AVX2) ...")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--force-reinstall", target]
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"[runtime] pip install failed: {e}")
        return False


def _relaunch_app() -> None:
    """Re-exec app.py in the same interpreter so onnxruntime gets a fresh
    DLL-load attempt. Windows caches failed loads within a process, so an
    in-place re-import never picks up a newly-installed runtime or wheel."""
    args = [a for a in sys.argv[1:] if a != "--reinstall"]
    print("\n[runtime] Re-launching the app ...\n")
    rc = subprocess.call([sys.executable, str(Path(__file__).resolve()), *args])
    sys.exit(rc)


def _recover_after_onnxruntime_load_failure(err: BaseException) -> None:
    """Diagnose why onnxruntime's native load failed, attempt the matching
    recovery (install VC++ runtime, or downgrade ORT for non-AVX2 CPUs),
    then re-exec. Exits 1 with diagnostics if no automatic fix applies."""
    has_vc = _has_vcruntime()
    has_avx2 = _has_avx2()
    ort_ver = _onnxruntime_version()

    print()
    print("=" * 60)
    print("  onnxruntime failed to load")
    print("=" * 60)
    print(f"Underlying error: {err}")
    print(f"  installed onnxruntime:  {ort_ver or 'unknown'}")
    print(f"  VC++ 2015-2022 runtime: {'present' if has_vc else 'missing'}")
    print(f"  CPU AVX2 support:       {'yes' if has_avx2 else 'no'}")
    print()

    if not has_vc and not _recovery_attempted("vcredist"):
        print("VC++ runtime is missing — installing it now.")
        print("Accept the UAC prompt that appears.")
        _mark_recovery_attempted("vcredist")
        if _install_vcredist_with_uac():
            _relaunch_app()
            return
        print()
        print("Manual fix:")
        print(f"  1. Download {VC_REDIST_URL}")
        print("  2. Run it (accept the UAC prompt)")
        print("  3. Re-run this script")
        sys.exit(1)

    if not has_avx2 and not _recovery_attempted("avx2_downgrade"):
        print("CPU lacks AVX2 — modern onnxruntime wheels require it.")
        _mark_recovery_attempted("avx2_downgrade")
        if _downgrade_onnxruntime_for_no_avx2():
            _relaunch_app()
            return
        print()
        print("Manual fix:")
        print(
            f"  {sys.executable} -m pip install --force-reinstall "
            f"onnxruntime=={ORT_NO_AVX2_FALLBACK_VERSION}"
        )
        sys.exit(1)

    # Either every known recovery has already been tried, or VC++ is present
    # and AVX2 is reported — the cause is something we can't fix automatically.
    print("No automatic recovery applies. Likely culprits:")
    print("  - Antivirus quarantining onnxruntime_pybind11_state.pyd")
    print(
        f"  - Corrupt install: {sys.executable} -m pip install "
        "--force-reinstall onnxruntime"
    )
    print("  - 32-bit Python loading 64-bit wheels (or vice versa)")
    sys.exit(1)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

REQUIRED_FILES = ("model.onnx", "selected_tags.csv", "preprocessing.json")


def _discover_model_dirs() -> list[Path]:
    """Return every subdirectory of ROOT that looks like a usable model folder."""
    out: list[Path] = []
    if not ROOT.exists():
        return out
    for sub in sorted(ROOT.iterdir(), key=lambda p: p.name.lower()):
        if not sub.is_dir():
            continue
        if all((sub / f).exists() for f in REQUIRED_FILES):
            out.append(sub)
    return out


def _variant_rank(name: str) -> int:
    try:
        return HF_VARIANTS.index(name)
    except ValueError:
        return len(HF_VARIANTS)


def _is_tty() -> bool:
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except (AttributeError, OSError):
        return False


def _prompt_choice(prompt: str, options: list[tuple[str, str]], default_idx: int = 0) -> str | None:
    """Show a numbered terminal menu. Returns the chosen option's value, or None on EOF.

    options: list of (display_text, value).
    """
    if not options:
        return None
    if not _is_tty():
        return options[default_idx][1]

    print()
    print(prompt)
    for i, (display, _) in enumerate(options, 1):
        marker = "  <- press Enter for this" if i - 1 == default_idx else ""
        print(f"  {i}) {display}{marker}")
    while True:
        try:
            raw = input(f"Choice [1-{len(options)}, default {default_idx + 1}]: ").strip()
        except EOFError:
            return options[default_idx][1]
        if not raw:
            return options[default_idx][1]
        try:
            idx = int(raw) - 1
        except ValueError:
            print(f"  Please enter a number 1-{len(options)}.")
            continue
        if 0 <= idx < len(options):
            return options[idx][1]
        print(f"  Out of range. Pick 1-{len(options)}.")


def _download_variant(variant: str) -> Path | None:
    """Download a HuggingFace variant into ROOT/<variant>. Returns the folder on success."""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("[app] huggingface_hub is not installed — re-run with --reinstall.")
        return None

    print(f"[app] Downloading '{variant}' from huggingface.co/{HF_REPO_ID} ...")
    try:
        snapshot_download(
            repo_id=HF_REPO_ID,
            allow_patterns=[f"{variant}/*"],
            local_dir=str(ROOT),
        )
    except Exception as e:  # noqa: BLE001
        print(f"[app] Download failed: {e}")
        return None

    target = ROOT / variant
    missing = [f for f in REQUIRED_FILES if not (target / f).exists()]
    if missing:
        print(f"[app] Download finished but {target} is missing: {', '.join(missing)}")
        return None
    return target


def _interactive_pick_model() -> Path | None:
    """Show a friendly menu so non-technical users can pick or download a model.

    Returns the chosen model directory, or None if the user wants to start the
    UI without loading anything (they can pick from the web UI then).
    """
    discovered = _discover_model_dirs()
    discovered.sort(key=lambda p: (_variant_rank(p.name), p.name.lower()))
    discovered_names = {p.name for p in discovered}

    options: list[tuple[str, str]] = []
    actions: list[tuple[str, str]] = []  # parallel list of (action, payload)

    for p in discovered:
        desc = HF_VARIANT_DESC.get(p.name, "model folder")
        options.append((f"Use {p.name}  ({desc})", str(p)))
        actions.append(("load", str(p)))

    for v in HF_VARIANTS:
        if v in discovered_names:
            continue
        desc = HF_VARIANT_DESC.get(v, "")
        suffix = f"  ({desc})" if desc else ""
        options.append((f"Download {v} from HuggingFace{suffix}", v))
        actions.append(("download", v))

    options.append(("Open the web UI without loading anything (pick later from the page)", "skip"))
    actions.append(("skip", ""))

    if not _is_tty() and discovered:
        return discovered[0]
    if not _is_tty():
        return None

    print()
    print("=" * 50)
    print("  Oppai ONNX Tagger")
    print("=" * 50)
    if discovered:
        print(f"Found {len(discovered)} model folder(s) next to app.py.")
    else:
        print("No model folders found yet next to app.py.")
        print(f"Pick a variant to download from huggingface.co/{HF_REPO_ID}.")

    chosen = _prompt_choice("What would you like to do?", options, default_idx=0)
    if chosen is None:
        return None

    idx = next(i for i, (_, v) in enumerate(options) if v == chosen)
    action, payload = actions[idx]
    if action == "load":
        return Path(payload)
    if action == "download":
        return _download_variant(payload)
    return None  # skip


def _resolve_initial_model(cli_dir: str | None) -> Path | None:
    if cli_dir:
        p = Path(cli_dir).expanduser().resolve()
        if not p.is_dir():
            print(f"[app] --model-dir not a directory: {p}")
            return None
        missing = [f for f in REQUIRED_FILES if not (p / f).exists()]
        if missing:
            print(f"[app] --model-dir is missing required files: {', '.join(missing)}")
            return None
        return p
    return _interactive_pick_model()


def _run_app() -> None:
    import argparse
    import csv
    import json

    import numpy as np
    try:
        import onnxruntime as ort
    except ImportError as e:
        if _looks_like_native_load_failure(e):
            _recover_after_onnxruntime_load_failure(e)
            sys.exit(1)  # only reached if recover failed without exiting
        raise
    import gradio as gr
    from PIL import Image

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model-dir", type=str, default=None)
    cli_args, _ = parser.parse_known_args()

    cat_names = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta"}
    inv_cat_names = {v: k for k, v in cat_names.items()}

    # Mutable holder so the UI can swap models without restarting the process.
    state: dict = {
        "session": None,
        "tag_names": [],
        "categories": [],
        "skip_mask": None,
        "image_size": 0,
        "pad_color": (0, 0, 0),
        "mean": None,
        "std": None,
        "breakeven_threshold": None,
        "model_dir": None,
        "providers": [],
    }

    def _ort_providers() -> list[str]:
        available = ort.get_available_providers()
        if "DmlExecutionProvider" in available:
            return ["DmlExecutionProvider", "CPUExecutionProvider"]
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        return ["CPUExecutionProvider"]

    def load_model(model_dir: Path) -> str:
        model_dir = Path(model_dir).expanduser().resolve()
        if not model_dir.is_dir():
            raise FileNotFoundError(f"not a directory: {model_dir}")
        missing = [f for f in REQUIRED_FILES if not (model_dir / f).exists()]
        if missing:
            raise FileNotFoundError(
                f"{model_dir} is missing required files: {', '.join(missing)}"
            )

        tag_names: list[str] = []
        categories: list[int] = []
        with (model_dir / "selected_tags.csv").open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                tag_names.append(row["name"])
                categories.append(int(row["category"]))
        n_tags = len(tag_names)

        skip_mask = np.zeros(n_tags, dtype=bool)
        for i, name in enumerate(tag_names):
            if name in ("<PAD>", "<UNK>"):
                skip_mask[i] = True

        with (model_dir / "preprocessing.json").open(encoding="utf-8") as f:
            preproc = json.load(f)
        image_size = int(preproc["image_size"])
        pad_color = tuple(int(c) for c in preproc["pad_color_rgb"])
        mean = np.array(preproc["normalize_mean"], dtype=np.float32).reshape(3, 1, 1)
        std = np.array(preproc["normalize_std"], dtype=np.float32).reshape(3, 1, 1)

        # Calibrated breakeven (precision = recall) lives in pr_thresholds.json.
        # It is tuned for whole-eval-set precision and is far too strict for
        # interactive single-image tagging, so we surface it only as a hint.
        breakeven_threshold = None
        thr_path = model_dir / "pr_thresholds.json"
        if thr_path.exists():
            try:
                with thr_path.open(encoding="utf-8") as f:
                    thr_data = json.load(f)
                breakeven_threshold = float(thr_data["micro"]["pr_breakeven"]["threshold"])
            except (OSError, KeyError, ValueError, json.JSONDecodeError):
                pass

        providers = _ort_providers()
        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        print(f"[app] Loading {model_dir / 'model.onnx'} ({image_size}×{image_size}) ...")
        print(f"[app] Providers: {providers}")
        session = ort.InferenceSession(
            str(model_dir / "model.onnx"), sess_options=sess_opts, providers=providers
        )

        state.update(
            session=session,
            tag_names=tag_names,
            categories=categories,
            skip_mask=skip_mask,
            image_size=image_size,
            pad_color=pad_color,
            mean=mean,
            std=std,
            breakeven_threshold=breakeven_threshold,
            model_dir=model_dir,
            providers=providers,
        )
        return _status_md()

    def _status_md() -> str:
        if state["session"] is None:
            return (
                "**No model loaded.** Drop an ONNX model folder next to "
                "`app.py`, or use the **Download from HuggingFace** section below."
            )
        try:
            display = state["model_dir"].relative_to(ROOT)
        except ValueError:
            display = state["model_dir"]
        parts = [
            f"**Loaded:** `{display}`",
            f"{state['image_size']}×{state['image_size']}",
            f"{len(state['tag_names'])} tags",
            f"providers: {', '.join(state['providers'])}",
        ]
        if state["breakeven_threshold"] is not None:
            parts.append(f"P=R breakeven: {state['breakeven_threshold']:.3f}")
        return " — ".join(parts)

    def _dropdown_choices() -> list[tuple[str, str]]:
        out = []
        for p in _discover_model_dirs():
            try:
                label = str(p.relative_to(ROOT))
            except ValueError:
                label = p.name
            out.append((label, str(p)))
        return out

    def _current_value() -> str | None:
        return str(state["model_dir"]) if state["model_dir"] else None

    # Initial load (CLI override > default folder > first discovered)
    initial = _resolve_initial_model(cli_args.model_dir)
    if initial is not None:
        try:
            load_model(initial)
        except Exception as e:  # noqa: BLE001
            print(f"[app] Initial model load failed: {e!r}")
    else:
        print("[app] No model folder found yet — pick or download one in the UI.")

    def letterbox(img: Image.Image):
        img = img.convert("RGB")
        w, h = img.size
        size = state["image_size"]
        scale = min(size / w, size / h)
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        resized = img.resize((nw, nh), Image.BICUBIC)
        canvas = Image.new("RGB", (size, size), state["pad_color"])
        x0 = (size - nw) // 2
        y0 = (size - nh) // 2
        canvas.paste(resized, (x0, y0))
        mask = np.ones((size, size), dtype=bool)  # True = padded
        mask[y0:y0 + nh, x0:x0 + nw] = False
        return canvas, mask

    def preprocess(img: Image.Image):
        canvas, mask = letterbox(img)
        arr = np.asarray(canvas, dtype=np.float32) / 255.0
        arr = arr.transpose(2, 0, 1)  # CHW
        arr = (arr - state["mean"]) / state["std"]
        return arr.astype(np.float32), mask

    def predict(image, threshold: float, max_tags, category_filter):
        if state["session"] is None:
            return "", "*no model loaded — pick or download one above*"
        if image is None:
            return "", "*upload an image to start*"
        try:
            max_tags_i = int(max_tags) if max_tags is not None else 0
            if max_tags_i <= 0:
                return "", "*no tags above threshold*"

            # An empty list means "no categories selected" -> show nothing.
            # `None` (event before component initialized) means "no filter".
            if category_filter is None:
                keep_cats = None
            else:
                keep_cats = {inv_cat_names[c] for c in category_filter if c in inv_cat_names}
                if not keep_cats:
                    return "", "*no tags above threshold*"

            pixel_values, padding_mask = preprocess(image)
            outputs = state["session"].run(
                ["probabilities"],
                {
                    "pixel_values": pixel_values[None, ...],
                    "padding_mask": padding_mask[None, ...],
                },
            )
            probs = outputs[0][0].astype(np.float32)
            probs[state["skip_mask"]] = -1.0  # never surface PAD/UNK

            order = np.argsort(-probs)
            results = []
            tag_names = state["tag_names"]
            categories = state["categories"]
            for idx in order:
                p = float(probs[idx])
                if p < threshold:
                    break
                cat = categories[idx]
                if keep_cats is not None and cat not in keep_cats:
                    continue
                results.append((tag_names[idx], p, cat))
                if len(results) >= max_tags_i:
                    break

            if not results:
                return "", "*no tags above threshold*"

            comma = ", ".join(name.replace("_", " ") for name, _, _ in results)
            lines = ["| # | Tag | Confidence | Category |", "|---|---|---|---|"]
            for i, (name, p, cat) in enumerate(results, 1):
                lines.append(f"| {i} | `{name}` | {p:.3f} | {cat_names.get(cat, str(cat))} |")
            return comma, "\n".join(lines)
        except Exception as e:  # noqa: BLE001 — keep Gradio toast away
            print(f"[app] predict() error: {e!r}")
            return "", f"*error during inference: {e}*"

    # --- UI callbacks ------------------------------------------------------

    def on_refresh():
        choices = _dropdown_choices()
        return gr.update(choices=choices, value=_current_value()), _status_md()

    def on_load(dropdown_value: str | None, custom_path: str):
        target = (custom_path or "").strip() or dropdown_value
        if not target:
            return gr.update(), _status_md(), "Pick a model folder or paste a path first."
        try:
            load_model(Path(target))
        except Exception as e:  # noqa: BLE001
            return gr.update(), _status_md(), f"Load failed: {e}"
        choices = _dropdown_choices()
        return (
            gr.update(choices=choices, value=_current_value()),
            _status_md(),
            f"Loaded `{Path(target).name}`.",
        )

    def on_download(variant: str, progress=gr.Progress(track_tqdm=True)):
        if not variant:
            return gr.update(), _status_md(), "Pick a variant first."
        try:
            from huggingface_hub import snapshot_download
        except ImportError:
            return (
                gr.update(),
                _status_md(),
                "huggingface_hub is not installed — re-run `app.py --reinstall`.",
            )
        progress(0, desc=f"Downloading {variant} from {HF_REPO_ID} ...")
        try:
            snapshot_download(
                repo_id=HF_REPO_ID,
                allow_patterns=[f"{variant}/*"],
                local_dir=str(ROOT),
            )
        except Exception as e:  # noqa: BLE001
            return gr.update(), _status_md(), f"Download failed: {e}"

        target = ROOT / variant
        msg = f"Downloaded `{variant}`."
        if all((target / f).exists() for f in REQUIRED_FILES):
            try:
                load_model(target)
                msg += f" Loaded `{variant}`."
            except Exception as e:  # noqa: BLE001
                msg += f" Load failed: {e}"
        choices = _dropdown_choices()
        return gr.update(choices=choices, value=_current_value()), _status_md(), msg

    # --- UI layout ---------------------------------------------------------

    with gr.Blocks(title="Oppai ONNX Tagger") as demo:
        gr.Markdown(
            "# Oppai ONNX Tagger\n"
            "Upload an image and tweak the threshold / max tags. "
            "Pick a model below or download one from "
            "[Grio43/OppaiOracle](https://huggingface.co/Grio43/OppaiOracle)."
        )

        with gr.Accordion("Model", open=True):
            with gr.Row():
                model_dd = gr.Dropdown(
                    choices=_dropdown_choices(),
                    value=_current_value(),
                    label="Detected model folders (next to app.py)",
                    interactive=True,
                    scale=3,
                )
                refresh_btn = gr.Button("Refresh", scale=1)
            with gr.Row():
                custom_path = gr.Textbox(
                    label="…or paste a custom model folder path (overrides dropdown)",
                    placeholder=r"e.g. C:\models\my_onnx_folder",
                    scale=4,
                )
                load_btn = gr.Button("Load", variant="primary", scale=1)
            with gr.Row():
                hf_dd = gr.Dropdown(
                    choices=HF_VARIANTS,
                    value=HF_VARIANTS[0],
                    label=f"Download a variant from {HF_REPO_ID}",
                    scale=3,
                )
                download_btn = gr.Button("Download", scale=1)
            status_md = gr.Markdown(_status_md())
            action_msg = gr.Markdown("")

        with gr.Row():
            with gr.Column(scale=1):
                inp = gr.Image(type="pil", label="Image", height=448)
                threshold = gr.Slider(
                    0.0, 1.0,
                    value=0.35,
                    step=0.005,
                    label="Threshold (interactive default 0.35; calibrated breakeven shown above)",
                )
                max_tags = gr.Slider(1, 200, value=50, step=1, label="Max tags")
                cats = gr.CheckboxGroup(
                    choices=list(cat_names.values()),
                    value=list(cat_names.values()),
                    label="Categories to include",
                )
                btn = gr.Button("Tag image", variant="primary")
            with gr.Column(scale=1):
                tags_out = gr.Textbox(
                    label="Tags (comma-separated, underscores → spaces)",
                    lines=5,
                )
                table_out = gr.Markdown(label="Per-tag detail")

        refresh_btn.click(on_refresh, outputs=[model_dd, status_md])
        load_btn.click(on_load, inputs=[model_dd, custom_path], outputs=[model_dd, status_md, action_msg])
        download_btn.click(on_download, inputs=[hf_dd], outputs=[model_dd, status_md, action_msg])

        ev_inputs = [inp, threshold, max_tags, cats]
        ev_outputs = [tags_out, table_out]
        btn.click(predict, ev_inputs, ev_outputs)
        inp.change(predict, ev_inputs, ev_outputs)
        threshold.release(predict, ev_inputs, ev_outputs)
        max_tags.release(predict, ev_inputs, ev_outputs)
        cats.change(predict, ev_inputs, ev_outputs)

    # CPU inference is ~1-3s per image; cap concurrency so spammed slider
    # changes queue serially instead of fighting for the same model session.
    demo.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1", server_port=7860, inbrowser=True
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    # On Windows, the console codepage is often cp1252/cp932/etc., not UTF-8.
    # Our messages contain em-dashes and × — `errors="replace"` keeps them from
    # crashing the bootstrap with UnicodeEncodeError on those consoles.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, OSError):
            pass

    force = "--reinstall" in sys.argv[1:]

    try:
        if _running_portable_python():
            # run.bat downloaded an embeddable Python because the user had none.
            # Install requirements directly into it; no venv re-exec needed.
            _bootstrap_portable(force_reinstall=force)
            _run_app()
            return

        if not _in_target_venv():
            _bootstrap(force_reinstall=force)
            return  # _bootstrap re-execs and exits
        _run_app()
    except KeyboardInterrupt:
        print("\n[setup] Cancelled by user.")
        sys.exit(130)


if __name__ == "__main__":
    main()
