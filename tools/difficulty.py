#!/usr/bin/env python3
"""ReadHound 难度引擎 v0 — 纯代码硬指标（提案 §5）。

输入：一篇中文文本 + 一份已知字表（CSV：char, first_semester, ...）。
输出：字表覆盖率、生字密度、句长、难度分与通过/复核/淘汰判定。

判定阈值（提案 §9 定版）：
  - 每篇新字约 5 个（以「未见过的字种数」计）
  - PASS：生字种数 <= 8 且字表覆盖率（按字次）>= 97%
  - REVIEW：生字种数 <= 15（可进书单但需人工复核 / 降级到复习环节）
  - REJECT：其余
  - 篇幅只报告、不参与判定（样例文本有长有短；生产入库时目标 600-900 字）

注意：
  - 字表用的是统编版「会写字表」（见 wordlists/README.md），
    它比课标认读量保守；孩子本人的已掌握字表由冷启动测评校准后替换。
  - 入库前先做繁简归一：繁体字形先转简体再比对，否则字形差异
    会虚增生字数。TRAD2SIMP 只覆盖本样例出现的字，生产版应接
    完整的繁简对照表。
"""
import csv
import json
import re
import sys
from collections import Counter

HAN = re.compile(r"[\u4e00-\u9fff]")
SENT_SPLIT = re.compile(r"[。！？；;!?]+")

# 仅用于样例的繁简对照（逐字核对过本样例出现的繁体字）
TRAD2SIMP = {
    "動": "动", "勝": "胜", "恆": "恒", "於": "于", "歸": "归",
    "漸": "渐", "為": "为", "爭": "争", "發": "发", "約": "约",
    "編": "编", "緩": "缓", "臥": "卧", "與": "与", "蓋": "盖",
    "號": "号", "見": "见", "視": "视", "覺": "觉", "貴": "贵",
    "賽": "赛", "輕": "轻", "進": "进", "過": "过", "遠": "远",
    "遲": "迟", "雖": "虽", "驚": "惊", "龜": "龟",
}


def load_wordlist(path, through_semester="4上"):
    order = ["1上", "1下", "2上", "2下", "3上", "3下", "4上", "4下"]
    upto = order.index(through_semester)
    known = set()
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if order.index(row["first_semester"]) <= upto:
                known.add(row["char"])
    return known


def analyze(text, known, normalize_trad=True):
    if normalize_trad:
        text = "".join(TRAD2SIMP.get(c, c) for c in text)
    han = HAN.findall(text)
    total = len(han)
    counts = Counter(han)
    unknown = {c: n for c, n in counts.items() if c not in known}
    unknown_tokens = sum(unknown.values())
    sentences = [s for s in SENT_SPLIT.split(text) if HAN.search(s)]
    sent_lens = [len(HAN.findall(s)) for s in sentences]
    coverage = (total - unknown_tokens) / total * 100 if total else 0.0
    verdict = (
        "PASS" if len(unknown) <= 8 and coverage >= 97
        else "REVIEW" if len(unknown) <= 15
        else "REJECT"
    )
    return {
        "total_han": total,
        "unique_han": len(counts),
        "coverage_pct": round(coverage, 2),
        "unknown_unique": len(unknown),
        "unknown_tokens": unknown_tokens,
        "unknown_per_100": round(unknown_tokens / total * 100, 2) if total else 0.0,
        "unknown_list": sorted(unknown.items(), key=lambda kv: (-kv[1], kv[0])),
        "sentences": len(sentences),
        "avg_sentence_len": round(sum(sent_lens) / len(sent_lens), 1) if sent_lens else 0,
        "longest_sentence": max(sent_lens) if sent_lens else 0,
        "verdict": verdict,
    }


if __name__ == "__main__":
    wordlist = sys.argv[1]
    known = load_wordlist(wordlist)
    print(f"known baseline (through 4上): {len(known)} chars")
    out = {}
    for path in sys.argv[2:]:
        text = open(path, encoding="utf-8").read()
        for norm in (False, True):
            key = f"{path}|trad_normalized={norm}"
            out[key] = analyze(text, known, normalize_trad=norm)
            r = out[key]
            print(f"\n== {path} (normalize={norm}) ==")
            print(f"  汉字 {r['total_han']} / 字种 {r['unique_han']} / 句 {r['sentences']} / "
                  f"平均句长 {r['avg_sentence_len']} 字 / 最长句 {r['longest_sentence']} 字")
            print(f"  覆盖率 {r['coverage_pct']}% / 生字种 {r['unknown_unique']} / "
                  f"生字字次 {r['unknown_tokens']} / 每百字生字 {r['unknown_per_100']}")
            print(f"  生字表：{'、'.join(c + '×' + str(n) for c, n in r['unknown_list'])}")
            print(f"  判定：{r['verdict']}")
    json.dump(out, open("/tmp/readhound-work/docs/difficulty-sample.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
