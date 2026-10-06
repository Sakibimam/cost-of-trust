Claim: Koios can identify a Masumi registry asset for a seller key on Preprod in one bounded probe, and an unknown asset returns no match.
Verdict: CONFIRMED
Measured: `python3 /Users/user/Desktop/canton/token2049-origins/research/pivot/m1/registry_probe.py` completed in about 42 seconds and returned 1 seller address and 1 registry match under policy `ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9`; the matched asset fingerprint was `asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn`. A direct Koios unknown-asset request returned HTTP 200 with an empty result in 1.035 seconds.
Negative case: the probe's unknown asset request produced no asset record, so the report must preserve `not_found` rather than infer registry metadata.
Caveat: the reusable probe is keyed by seller credential and scans both known registry policies; an arbitrary agent identifier still needs identifier-shape routing and a bounded asset lookup. Koios history is live but may be rate-limited.
Blocks product: no
