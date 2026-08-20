"""
数据重复验证脚本
检查 websites.json 中的 id、url、name 是否重复，以及分类统计

用法：
    python data/check_duplicates.py
"""
import json
import sys
from collections import Counter
from pathlib import Path

JSON_PATH = Path(__file__).parent / "websites.json"


def main():
    try:
        with open(JSON_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"错误：找不到文件 {JSON_PATH}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"错误：JSON 格式无效 - {e}")
        sys.exit(1)

    print(f"总条目数: {len(data)}")
    print("=" * 60)

    # 检查必填字段
    required = ["id", "name", "url", "description", "category", "keywords"]
    missing = []
    for i, d in enumerate(data):
        for k in required:
            if k not in d or not d[k]:
                missing.append(f"  第 {i+1} 条缺少字段: {k}")
    if missing:
        print(f"\n❌ 缺失字段 ({len(missing)}):")
        for m in missing:
            print(m)
    else:
        print("✅ 所有必填字段完整")

    # 检查ID重复
    id_counts = Counter(d["id"] for d in data)
    dup_ids = {k: v for k, v in id_counts.items() if v > 1}
    if dup_ids:
        print(f"\n❌ 重复 ID ({len(dup_ids)}):")
        for k, v in dup_ids.items():
            print(f"  {k}: 出现 {v} 次")
    else:
        print("✅ ID 无重复")

    # 检查URL重复
    url_counts = Counter(d["url"] for d in data)
    dup_urls = {k: v for k, v in url_counts.items() if v > 1}
    if dup_urls:
        print(f"\n❌ 重复 URL ({len(dup_urls)}):")
        for k, v in dup_urls.items():
            print(f"  {k}: 出现 {v} 次")
    else:
        print("✅ URL 无重复")

    # 检查名称重复（警告）
    name_counts = Counter(d["name"] for d in data)
    dup_names = {k: v for k, v in name_counts.items() if v > 1}
    if dup_names:
        print(f"\n⚠️  重复名称 ({len(dup_names)}):")
        for k, v in dup_names.items():
            print(f"  {k}: 出现 {v} 次")
    else:
        print("✅ 名称无重复")

    # 分类统计
    cats = Counter(d["category"] for d in data)
    print(f"\n分类统计（{len(cats)} 个分类，按数量降序）:")
    for cat, cnt in sorted(cats.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {cat}: {cnt}")

    # 描述长度统计
    lengths = [len(d["description"]) for d in data]
    print(f"\n描述长度统计:")
    print(f"  最短: {min(lengths)} 字")
    print(f"  最长: {max(lengths)} 字")
    print(f"  平均: {sum(lengths) / len(lengths):.1f} 字")

    # 汇总
    print("\n" + "=" * 60)
    problems = len(missing) + len(dup_ids) + len(dup_urls)
    if problems == 0:
        print("✅ 数据验证通过，无严重问题")
    else:
        print(f"❌ 发现 {problems} 个问题需要修复")
        sys.exit(1)


if __name__ == "__main__":
    main()
