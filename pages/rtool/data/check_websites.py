"""
网站访问验证脚本
批量核验 websites.json 中所有URL的HTTP可达性

用法：
    python data/check_websites.py
    python data/check_websites.py --timeout 20
    python data/check_websites.py --output report.csv
    python data/check_websites.py --limit 10    # 只验证前10条（测试用）
"""
import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

JSON_PATH = Path(__file__).parent / "websites.json"

# 模拟浏览器 User-Agent，避免被部分WAF拦截
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def check_url(url: str, timeout: int) -> tuple:
    """核验单个URL，返回 (status_code, status, note)"""
    # 先尝试 HEAD
    req = urllib.request.Request(url, headers=HEADERS, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, "成功", ""
    except urllib.error.HTTPError as e:
        code = e.code
        if code in (403, 429):
            return code, "WAF拦截", f"HTTP {code}，自动化请求被拦截，域名可能有效"
        if code == 404:
            return code, "404失效", "页面不存在，可能真实失效"
        if 400 <= code < 500:
            return code, "HTTP错误", f"HTTP {code}"
        if 500 <= code < 600:
            return code, "服务器错误", f"HTTP {code}，源站临时故障"
        return code, "HTTP错误", f"HTTP {code}"
    except urllib.error.URLError as e:
        reason = str(e.reason)
        if "Name or service not known" in reason or "getaddrinfo" in reason or "nodename" in reason:
            return 0, "DNS失败", "域名解析失败，可能真实失效"
        if "timed out" in reason.lower() or "timeout" in reason.lower():
            return 0, "超时", "连接超时，可能WAF拦截或网络问题"
        # HEAD 失败，尝试 GET
        req_get = urllib.request.Request(url, headers=HEADERS, method="GET")
        try:
            with urllib.request.urlopen(req_get, timeout=timeout) as resp:
                return resp.status, "成功", ""
        except urllib.error.HTTPError as e:
            code = e.code
            if code in (403, 429):
                return code, "WAF拦截", f"HTTP {code}（GET），域名可能有效"
            if code == 404:
                return code, "404失效", "页面不存在（GET）"
            return code, "HTTP错误", f"HTTP {code}（GET）"
        except Exception as e2:
            return 0, "失败", str(e2)[:60]
    except Exception as e:
        return 0, "失败", str(e)[:60]


def main():
    parser = argparse.ArgumentParser(description="网站访问验证脚本")
    parser.add_argument("--timeout", type=int, default=15, help="请求超时秒数（默认15）")
    parser.add_argument("--output", type=str, default=None, help="输出CSV路径（默认 verify_results.csv）")
    parser.add_argument("--limit", type=int, default=0, help="只验证前N条（0=全部）")
    parser.add_argument("--workers", type=int, default=10, help="并发数（默认10）")
    args = parser.parse_args()

    output_path = args.output or str(JSON_PATH.parent / "verify_results.csv")

    try:
        with open(JSON_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"错误：找不到 {JSON_PATH}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"错误：JSON 格式无效 - {e}")
        sys.exit(1)

    if args.limit > 0:
        data = data[:args.limit]

    total = len(data)
    print(f"准备核验 {total} 个URL，超时 {args.timeout}s，并发 {args.workers}")
    print("=" * 70)

    results = []
    done = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(check_url, site["url"], args.timeout): site
            for site in data
        }
        for future in as_completed(futures):
            site = futures[future]
            code, status, note = future.result()
            results.append({
                "id": site["id"],
                "name": site["name"],
                "url": site["url"],
                "category": site["category"],
                "code": code,
                "status": status,
                "note": note,
            })
            done += 1
            if done % 20 == 0 or done == total:
                print(f"  进度: {done}/{total}")

    # 写CSV
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "name", "url", "category", "code", "status", "note"])
        writer.writeheader()
        writer.writerows(results)

    # 汇总统计
    from collections import Counter
    status_counts = Counter(r["status"] for r in results)

    print()
    print("=" * 70)
    print(f"核验完成，结果已保存至 {output_path}")
    print()
    print("汇总统计：")
    print(f"  ✅ 成功访问:    {status_counts.get('成功', 0)}")
    print(f"  ❌ DNS失败:     {status_counts.get('DNS失败', 0)}")
    print(f"  ⚠️  超时:        {status_counts.get('超时', 0)}")
    print(f"  ⚠️  WAF拦截:     {status_counts.get('WAF拦截', 0)}")
    print(f"  ❌ HTTP错误:    {status_counts.get('HTTP错误', 0)}")
    print(f"  ❌ 404失效:     {status_counts.get('404失效', 0)}")
    print(f"  ⚠️  服务器错误:  {status_counts.get('服务器错误', 0)}")
    print(f"  ❌ 其他失败:    {status_counts.get('失败', 0)}")

    # 需要处理的条目
    need_action = [r for r in results if r["status"] in ("DNS失败", "404失效")]
    if need_action:
        print()
        print(f"需要处理的条目（{len(need_action)} 条，可能需删除或修正）:")
        for r in need_action:
            print(f"  ❌ {r['id']}: {r['name']} - {r['url']}")
            print(f"      {r['note']}")
    else:
        print()
        print("✅ 无需删除的条目")

    # 需注意的条目
    warn = [r for r in results if r["status"] in ("超时", "WAF拦截", "服务器错误")]
    if warn:
        print()
        print(f"需注意的条目（{len(warn)} 条，域名可能有效，建议人工复核）:")
        for r in warn:
            print(f"  ⚠️  {r['id']}: {r['name']} - {r['status']} - {r['note']}")

    # 退出码
    if need_action:
        sys.exit(1)


if __name__ == "__main__":
    main()
