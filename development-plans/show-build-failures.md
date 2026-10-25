# Show Build Failures

**One page for all your Actions failures:** GitHub has no account-wide Actions dashboard. The closest is notifications: GitHub can email you, or show at github.com/notifications, when a workflow run _you_ triggered fails. The setting is under Settings → Notifications → Actions, "Only notify for failed workflows". That's zero work, if those emails aren't being filtered away.

**From git:** no. Workflow results live on GitHub, not in the repository, so git can't see them.

**Your git-all-status tool** would be a good home for this:

- **Which repos:** only ask about repositories that have a GitHub remote and a `.github/workflows/` folder.
- **One request each:** `https://api.github.com/repos/OWNER/REPO/actions/runs?branch=master&per_page=1`. That's what I used to spot riemann's failed deploy. Public repos need no token, but the limit without one is 60 requests an hour. An optional `GITHUB_TOKEN` raises it to 5,000.
- **What to report:** "deploy failed", or "deploy running", as another needs-attention reason. Compare the run's `head_sha` with what you pushed, so you know the result is for your latest commit.

## Rationale

It's a minor pain to go to the github actions page for the project I'm working on, much less all projects.
This project already goes to each project looking for related issues, so this seems like a good place.
