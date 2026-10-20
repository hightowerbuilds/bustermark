#!/bin/sh
# Stand-in for the Claude Code CLI in the Phase 3 failure-path check (growth/phases/phase-3.md).
# Debug builds look for `claude` only in BUSTERMARK_CLI_DIR; each variant folder's `claude` runs
#   fake-claude.sh <mode> "$@"
# signed-out  `auth status` reports signed out.
# crash       prints a non-JSON line, then dies with an error on the first message.
# expired     signed in until the first message, which fails "Not logged in"; after that
#             `auth status` reports signed out (the marker lives in BUSTERMARK_FAKE_STATE).
mode=$1; shift
marker="${BUSTERMARK_FAKE_STATE:-${TMPDIR:-/tmp}}/bustermark-fake-claude-expired"
signed_in() { [ "$mode" != signed-out ] && { [ "$mode" != expired ] || [ ! -f "$marker" ]; }; }

case "$1" in
  --version) echo "2.1.304 (Claude Code, fake $mode)"; exit 0 ;;
  auth)
    if signed_in; then echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'
    else echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'; fi
    exit 0 ;;
esac

# A conversation (`-p --input-format stream-json`): answer each message by mode.
[ "$mode" = crash ] && echo "fake claude: warming up (not JSON)"
echo '{"type":"system","subtype":"init","session_id":"fake-session","model":"fake"}'
while IFS= read -r _message; do
  case "$mode" in
    crash) echo "fake claude: connection reset while streaming" >&2; exit 1 ;;
    expired)
      : > "$marker"
      echo '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","session_id":"fake-session"}' ;;
    *) echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"fake-session"}' ;;
  esac
done
