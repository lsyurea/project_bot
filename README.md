# Project Bot

This repository automatically updates repository activity stats for my GitHub account.

## GitHub Actions Setup

1. Add repository secret: `GH_ACTIVITY_TOKEN`
   - This token must be able to read your personal repositories (including private) and write contents to this repository.
2. Username is set in workflow as `GH_USERNAME: lsyurea`.
   - Edit `.github/workflows/repo-activity.yml` if you want a different account.
3. (Optional) Add repository variable: `ACTIVE_DAYS`
   - Defaults to `90` if not set.

After pushing the workflow, GitHub Actions runs automatically on schedule (`0 3 * * *`, UTC) and can also be triggered manually from the Actions tab.

## Repository Activity

<!-- REPO_ACTIVITY:START -->

This section is updated automatically by a scheduled GitHub Action.

<!-- REPO_ACTIVITY:END -->
