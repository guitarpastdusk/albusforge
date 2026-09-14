# docs/checkin/

Check-in submissions for the Battle of the Coasts hackathon (Deep Tech / Physical AI track). There's one every 12 hours, each describing what the build is at that point.

| Check-in | Hour | Files |
| --- | --- | --- |
| 1 | 12 | [CHECKIN-1.md](CHECKIN-1.md) · [CHECKIN-1.pdf](CHECKIN-1.pdf) |
| 2 | 24 | [CHECKIN-2.md](CHECKIN-2.md) · [CHECKIN-2.pdf](CHECKIN-2.pdf) · [Evidence and statistics](CHECKIN-2-EVIDENCE.md) |
| 3 | 36 | [CHECKIN-3.md](CHECKIN-3.md) · [CHECKIN-3.pdf](CHECKIN-3.pdf) · [Evidence and statistics](CHECKIN-3-EVIDENCE.md) |

The Markdown is the source, and GitHub renders its Mermaid diagram. The PDF is exported from it for submission.

Check-in 2 follows the Team Playbook's judging rubric and fixes its statistics
to `CHECKIN1` → `cbfaa17`. The evidence appendix records the git boundary,
every merged PR, exact CI runs, local CAD verification, live checks and pending
work. Later changes to main do not change that snapshot.

Check-in 3 fixes its statistics to `CHECKIN2` (`28c4ac1`) → `CHECKIN3` (`38c93d0`).
Its test counts are the CI runner's own totals rather than static greps, and its
evidence appendix separates the product's firmware from the separate Freenove
hardware bring-up, which uses ESPHome and does not reach our cloud.
