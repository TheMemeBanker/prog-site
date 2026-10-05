#!/usr/bin/env python3
"""PROG snapshot — pulls the public otcdesks.cash JSON feeds and writes a trimmed
data/live.json for the desk to read. No secrets, no auth, stdlib only.
Run by .github/workflows/refresh.yml on a schedule; safe to run by hand."""
import json, os, sys, time, urllib.request

BASE = "https://otcdesks.cash/api/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "live.json")
LAMPORTS = 1e9
OTC_DEC = 1e6


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "prog.cash snapshot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:  # local macOS Pythons often lack a CA bundle; curl has one
        import subprocess
        r = subprocess.run(["curl", "-sS", "--max-time", "60", "-H", "User-Agent: prog.cash snapshot/1.0", BASE + path], capture_output=True, text=True)
        if r.returncode != 0 or not r.stdout.strip():
            raise RuntimeError(f"{path}: {e}; curl: {r.stderr.strip()[:200]}")
        return json.loads(r.stdout)


def main():
    rewards = get("rewards")
    stats = get("stats")
    revenue = get("revenue")
    coins = get("coins")

    daily = [
        {"day": d["day"], "earned": round(d["earned"] / LAMPORTS, 3), "distributed": round(d["distributed"] / LAMPORTS, 3), "claims": d.get("claims", 0)}
        for d in stats.get("daily", [])
    ]
    top = [
        {
            "mint": t["mint"], "symbol": t.get("symbol"), "name": t.get("name"), "reward": t.get("rewardSymbol"),
            "distributed": round(t["distributed"] / LAMPORTS, 3), "holders_paid": t.get("holdersPaid", 0),
            "mcap": round(t.get("marketCap") or 0),
        }
        for t in rewards.get("top", [])
    ]
    recent = [
        {
            "at": x["at"], "symbol": x.get("symbol"), "name": x.get("name"), "mint": x.get("mint"), "asset": x.get("assetSymbol"),
            "amount": x["amount"] / (10 ** x.get("decimals", 0)), "usd": round(x.get("usd") or 0, 4),
            "holders": x.get("holders", 0), "sig": x.get("signature"),
        }
        for x in rewards.get("recent", [])
    ]
    by_asset = sorted(
        [{"symbol": b["symbol"], "distributed": round(b["distributed"] / LAMPORTS, 3), "coins": b.get("coins", 0)} for b in stats.get("byStock", [])],
        key=lambda b: -b["distributed"],
    )[:12]
    new_coins = [
        {"mint": c["mint"], "symbol": c.get("symbol"), "name": c.get("name"), "reward": c.get("rewardSymbol"), "basket": len(c.get("rewardBasket") or []), "created": c.get("createdAt")}
        for c in coins.get("coins", [])
    ]
    bb = revenue.get("buyback", {})
    snap = {
        "at": int(time.time()),
        "feeds_at": {"rewards": rewards.get("at"), "stats": stats.get("at"), "revenue": revenue.get("at")},
        "rewards": {
            "distributed": round(rewards["distributed"] / LAMPORTS, 3),
            "owed": round(rewards.get("owed", 0) / LAMPORTS, 4),
            "payouts": rewards.get("payouts", 0),
            "holders_paid": rewards.get("holdersPaid", 0),
            "paying": rewards.get("paying", 0),
            "assets": rewards.get("assets", 0),
            "last_distributed_at": rewards.get("lastDistributedAt"),
        },
        "stats": {
            "coins": stats.get("coins", 0), "earning": stats.get("earning", 0),
            "earned": round(stats["earned"] / LAMPORTS, 3),
            "to_pot": round(stats.get("toPot", 0) / LAMPORTS, 3),
            "to_protocol": round(stats.get("toProtocol", 0) / LAMPORTS, 3),
            "to_buyback": round(stats.get("toBuyback", 0) / LAMPORTS, 3),
            "burned_otc": round(stats.get("buybackBurned", 0) / OTC_DEC),
            "burns": bb.get("burns", len(stats.get("buybackBurns", []))),
            "volume_24h": round(stats.get("volume24h") or 0), "volume_7d": round(stats.get("volume7d") or 0), "volume_all": round(stats.get("volumeAll") or 0),
            "daily": daily,
        },
        "otc": {"usd": (revenue.get("otc") or {}).get("usdPrice"), "mcap": round((revenue.get("otc") or {}).get("marketCap") or 0), "change24h": (revenue.get("otc") or {}).get("change24h")},
        "top": top, "recent": recent, "by_asset": by_asset, "new_coins": new_coins, "coins_total": coins.get("total"),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(snap, f, separators=(",", ":"))
    print(f"wrote {OUT}: distributed {snap['rewards']['distributed']} SOL, paying {snap['rewards']['paying']} coins, recent {len(recent)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("snapshot failed:", e, file=sys.stderr)
        sys.exit(1)
