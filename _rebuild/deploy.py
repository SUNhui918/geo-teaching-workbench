# -*- coding: utf-8 -*-
"""
日常更新：把本地工作台目录推到 GitHub Pages（约 1-2 分钟生效）。

用法:
    python deploy.py                 # 推送脚本上一级目录（即整个工作台）
    python deploy.py D:/some/dist    # 指定目录

令牌（必需）二选一:
    1) 环境变量 GITHUB_TOKEN
    2) 本文件夹下 token.txt，一行写令牌

安全设计:
    * 脚本内不含任何明文令牌
    * token.txt / 进度文件 / __pycache__ 一律排除，绝不上传
    * 推送前核对本地文件数，明显少于云端时拒绝执行，防止误删线上内容
"""
import os
import sys
import json
import time
import base64
import hashlib
import tempfile
import urllib.error
import urllib.request

REPO = "SUNhui918/geo-teaching-workbench"
BASE = "https://api.github.com/repos/" + REPO
HERE = os.path.dirname(os.path.abspath(__file__))

SKIP_NAMES = {"token.txt", "upload_progress.json", ".DS_Store", "Thumbs.db"}
SKIP_DIRS = {".git", "__pycache__", ".idea", ".vscode"}
PROGRESS = os.path.join(tempfile.gettempdir(), "geo_workbench_upload_progress.json")


def read_token():
    t = os.environ.get("GITHUB_TOKEN", "").strip()
    if not t:
        p = os.path.join(HERE, "token.txt")
        if os.path.exists(p):
            t = open(p, encoding="utf-8").read().strip()
    return t


TOKEN = read_token()


def api(method, url, payload=None, retries=4):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "geo-workbench-deploy")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if e.code in (409, 422, 429) and attempt < retries - 1:
                time.sleep(5)
                continue
            print("HTTP %d %s" % (e.code, body), flush=True)
            raise
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(5)
                continue
            print("NETWORK %s" % type(e).__name__, flush=True)
            raise


def blob_sha(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\x00" + raw).hexdigest()


def collect(dist):
    files = []
    for root, dirs, fnames in os.walk(dist):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in fnames:
            if f in SKIP_NAMES or f.endswith(".pyc"):
                continue
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, dist).replace("\\", "/")
            files.append((rel, fp))
    files.sort()
    return files


def main():
    if not TOKEN:
        print("未找到令牌。请设置环境变量 GITHUB_TOKEN，或在本文件夹建 token.txt。", flush=True)
        print("生成方法见 README.md 第三步。", flush=True)
        sys.exit(1)

    dist = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(HERE)
    if not os.path.isdir(dist):
        print("目录不存在：%s" % dist, flush=True)
        sys.exit(1)

    # 基本完整性检查
    required = ["index.html", "sw.js", "lib/changelog.js", "lib/workbench-bar.js"]
    missing = [r for r in required if not os.path.exists(os.path.join(dist, r.replace("/", os.sep)))]
    if missing:
        print("缺少关键文件，已中止：%s" % ", ".join(missing), flush=True)
        print("请先运行 restore.py 完整恢复，再部署。", flush=True)
        sys.exit(1)

    files = collect(dist)
    try:
        tree = api("GET", BASE + "/git/trees/main?recursive=1")["tree"]
        remote = len([t for t in tree if t.get("type") == "blob"])
    except Exception:
        remote = 0
    if remote and len(files) < remote * 0.9:
        print("安全检查：本地 %d 个文件，云端 %d 个，疑似未完整恢复。" % (len(files), remote), flush=True)
        print("为防止误删线上内容，已中止。请先运行 restore.py。", flush=True)
        sys.exit(1)

    done = {}
    if os.path.exists(PROGRESS):
        try:
            done = json.load(open(PROGRESS, encoding="utf-8"))
        except Exception:
            done = {}
    print("本地 %d 个文件，云端 %d 个，已有缓存 %d 条" % (len(files), remote, len(done)), flush=True)

    entries = []
    changed = 0
    for i, (rel, fp) in enumerate(files, 1):
        with open(fp, "rb") as fh:
            raw = fh.read()
        sha = blob_sha(raw)
        if done.get(rel) == sha:
            entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": sha})
            continue
        b64 = base64.b64encode(raw).decode("ascii")
        new_sha = api("POST", BASE + "/git/blobs", {"content": b64, "encoding": "base64"})["sha"]
        changed += 1
        print("  上传 #%d %s" % (changed, rel), flush=True)
        done[rel] = new_sha
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": new_sha})
        with open(PROGRESS, "w", encoding="utf-8") as f:
            json.dump(done, f, ensure_ascii=False)
        if i % 60 == 0:
            print("  已扫描 %d/%d" % (i, len(files)), flush=True)

    tree_obj = api("POST", BASE + "/git/trees", {"tree": entries})
    parent = api("GET", BASE + "/git/ref/heads/main")["object"]["sha"]
    commit = api("POST", BASE + "/git/commits", {
        "message": "Update geography teaching workbench",
        "tree": tree_obj["sha"], "parents": [parent]})
    api("PATCH", BASE + "/git/refs/heads/main", {"sha": commit["sha"], "force": True})
    print("完成！共更新 %d 个文件，commit %s" % (changed, commit["sha"][:8]), flush=True)
    print("主站：https://sunhui918.github.io/geo-teaching-workbench/", flush=True)


if __name__ == "__main__":
    main()
