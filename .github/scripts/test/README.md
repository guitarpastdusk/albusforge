# .github/scripts/test/

`run.sh` tests the deploy scripts without GCP. A stub `gcloud` returns canned registry and Cloud Run output, and a throwaway git repository provides commit history for the ancestry checks.

Run `bash .github/scripts/test/run.sh`. It needs `bash`, `git` and `jq`, and works with macOS's bash 3.2.
