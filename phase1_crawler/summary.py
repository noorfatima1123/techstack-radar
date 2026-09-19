import json

with open("results.json", encoding="utf-8") as f:
    data = json.load(f)

print(f"\n{'Domain':<22} Technologies")
print("-" * 70)
for site in data:
    techs = ", ".join(t["name"] for t in site["technologies"]) or "(none detected)"
    print(f"{site['domain']:<22} {techs}")

# Quick stats
total_sites = len(data)
sites_with_tech = sum(1 for s in data if s["technologies"])
all_techs = {}
for s in data:
    for t in s["technologies"]:
        all_techs[t["name"]] = all_techs.get(t["name"], 0) + 1

print("\n" + "=" * 70)
print(f"Sites scanned: {total_sites}")
print(f"Sites with detections: {sites_with_tech}/{total_sites}")
print(f"Unique technologies found: {len(all_techs)}")
print("\nTechnology frequency:")
for name, count in sorted(all_techs.items(), key=lambda x: -x[1]):
    print(f"  {name:<28} {count}")