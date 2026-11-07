# -*- coding: utf-8 -*-
"""
新电脑第一步：从云端把工作台完整拉回本机。

用法:
    python restore.py                    # 输出到 ./geo-workbench
    python restore.py D:/myfolder        # 指定输出目录
    python restore.py --core             # 只拉小文件（跳过 >1MB 的图谱图片），几分钟拿到可用主体
    python restore.py --zip              # 尝试整包下载（国内通常很慢，不推荐）

下载通道（自动择优，全部走国内可达域名）:
    1) 主站 Pages 直连  sunhui918.github.io   —— 最快，无需令牌、无次数限制
    2) Blob API         api.github.com        —— 兜底，带令牌更稳
    3) raw / codeload                        —— 国内常不通或极慢，仅 --zip 时使用

断点续传：已存在且内容一致（git blob sha 校验）的文件自动跳过，中断后重跑即可。
令牌可选：环境变量 GITHUB_TOKEN 或同目录 token.txt（一行）。
"""
import os
import sys
import io
import json
import time
import base64
import zipfile
import hashlib
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO = "SUNhui918/geo-teaching-workbench"
BRANCH = "main"
API = "https://api.github.com/repos/" + REPO
PAGES = "https://sunhui918.github.io/geo-teaching-workbench/"
HERE = os.path.dirname(os.path.abspath(__file__))
CORE_LIMIT = 1024 * 1024          # --core 模式跳过大文件


def read_token():
    t = os.environ.get("GITHUB_TOKEN", "").strip()
    if not t:
        p = os.path.join(HERE, "token.txt")
        if os.path.exists(p):
            t = open(p, encoding="utf-8").read().strip()
    return t


TOKEN = read_token()


def http(url, timeout=40, extra=None):
    headers = {"User-Agent": "geo-workbench-restore"}
    if TOKEN and url.startswith("https://api.github.com"):
        headers["Authorization"] = "token " + TOKEN
    if extra:
        headers.update(extra)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def blob_sha(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\x00" + raw).hexdigest()


def write_file(out, rel, raw):
    dst = os.path.join(out, *rel.split("/"))
    parent = os.path.dirname(dst)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(dst, "wb") as f:
        f.write(raw)


def fetch(path, want_sha, timeout=30):
    """按通道优先级取一个文件，返回内容或 None。"""
    candidates = [PAGES + urllib.parse.quote(path, safe="/")]
    for url in candidates:
        try:
            raw = http(url, timeout=timeout)
            if blob_sha(raw) == want_sha:
                return raw
        except Exception:
            pass
    # 兜底：Git Blob API（公开仓库匿名可读，带令牌可提额）
    try:
        b = json.loads(http(API + "/git/blobs/" + want_sha, timeout=40))
        raw = base64.b64decode(b["content"])
        if blob_sha(raw) == want_sha:
            return raw
    except Exception:
        pass
    return None


def try_zip(out):
    print("尝试整包下载（国内可能很慢，超过 30 秒会自动放弃）...", flush=True)
    try:
        data = http(API + "/zipball/" + BRANCH, timeout=30,
                    extra={"Accept": "application/vnd.github+json"})
        z = zipfile.ZipFile(io.BytesIO(data))
    except Exception as e:
        print("整包不可用（%s），改用逐文件" % type(e).__name__, flush=True)
        return 0
    n = 0
    for info in z.infolist():
        try:
            name = info.filename.encode("cp437").decode("utf-8")
        except Exception:
            name = info.filename
        if info.is_dir() or "/" not in name:
            continue
        rel = name.split("/", 1)[1]
        if rel and not rel.startswith(".git/"):
            write_file(out, rel, z.read(info.filename))
            n += 1
    print("整包恢复完成：%d 个文件" % n, flush=True)
    return n


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    out = os.path.abspath(args[0]) if args else os.path.join(os.getcwd(), "geo-workbench")
    os.makedirs(out, exist_ok=True)
    print("工作台云端恢复 -> %s" % out, flush=True)
    print("令牌：%s ｜ 主站直连优先" % ("已配置" if TOKEN else "未配置（不需要也能拉）"), flush=True)

    if "--zip" in flags and try_zip(out):
        return

    tree = json.loads(http(API + "/git/trees/" + BRANCH + "?recursive=1", timeout=90))["tree"]
    blobs = [t for t in tree if t.get("type") == "blob" and t.get("sha") and t.get("path")]
    if "--core" in flags:
        big = [t for t in blobs if t.get("size", 0) > CORE_LIMIT]
        blobs = [t for t in blobs if t.get("size", 0) <= CORE_LIMIT]
        print("--core 模式：先拉 %d 个小文件，暂跳过 %d 个大图（之后不带 --core 重跑即可补齐）"
              % (len(blobs), len(big)), flush=True)

    total = len(blobs)
    workers = 8

    def job(t):
        path, want = t["path"], t["sha"]
        dst = os.path.join(out, *path.split("/"))
        if os.path.exists(dst):
            try:
                with open(dst, "rb") as f:
                    if blob_sha(f.read()) == want:
                        return "skip", path
            except Exception:
                pass
        raw = None
        for attempt in range(2):
            raw = fetch(path, want)
            if raw is not None:
                break
            time.sleep(1)
        if raw is None:
            return "fail", path
        write_file(out, path, raw)
        return "ok", path

    print("并发 %d 线程下载 ..." % workers, flush=True)
    ok = skip = fail = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(job, t) for t in blobs]
        for i, fu in enumerate(as_completed(futures), 1):
            status, path = fu.result()
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                fail += 1
                print("  X %s" % path, flush=True)
            if i % 100 == 0 or i == total:
                print("  %d/%d  新增%d 跳过%d 失败%d" % (i, total, ok, skip, fail), flush=True)

    print("完成：新增 %d，跳过 %d，失败 %d" % (ok, skip, fail), flush=True)
    if fail:
        print("失败的文件重跑一次本脚本即可补上（已下载的会自动跳过）", flush=True)
    print("目录：%s" % out, flush=True)


if __name__ == "__main__":
    main()
