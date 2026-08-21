#!/usr/bin/env bash
set -euo pipefail

# Palm.ai Local Runner — zero-cost, user-owned execution.
# Prerequisites: bash, curl, jq. Keep this process open while you want to claim Palm tasks.

: "${PALM_BASE_URL:?Set PALM_BASE_URL, for example https://your-palm-domain.example}"
: "${PALM_LOCAL_TOKEN:?Set PALM_LOCAL_TOKEN from Palm.ai Settings → Local Runner}"

RUNNER_DIR="${PALM_RUNNER_DIR:-$HOME/palm-local-results}"
INPUT_DIR="${PALM_INPUT_DIR:-$HOME/palm-local-input}"
mkdir -p "$RUNNER_DIR"
mkdir -p "$INPUT_DIR"

request() {
  curl --silent --show-error --fail-with-body \
    -H "Authorization: Local ${PALM_LOCAL_TOKEN}" \
    -H "Content-Type: application/json" "$@"
}

report() {
  local run_id="$1" sequence="$2" type="$3" status="$4" detail="$5" final_message="${6:-}"
  local payload
  if [[ -n "$final_message" ]]; then
    payload=$(jq -n --argjson seq "$sequence" --arg type "$type" --arg status "$status" --arg detail "$detail" --arg final "$final_message" '{eventSeq:$seq,type:$type,status:$status,detail:$detail,data:{finalMessage:$final}}')
  else
    payload=$(jq -n --argjson seq "$sequence" --arg type "$type" --arg status "$status" --arg detail "$detail" '{eventSeq:$seq,type:$type,status:$status,detail:$detail}')
  fi
  request -X POST "${PALM_BASE_URL}/api/v1/local-runners/runs/${run_id}/events" --data "$payload" >/dev/null
}

echo "Palm Local Runner started. Results will be written to ${RUNNER_DIR}"
while true; do
  request -X POST "${PALM_BASE_URL}/api/v1/local-runners/heartbeat" --data '{}' >/dev/null || { echo "Heartbeat failed; retrying in 10 seconds." >&2; sleep 10; continue; }
  assignment=$(request -X POST "${PALM_BASE_URL}/api/v1/local-runners/claim" --data '{}' || true)
  if [[ -z "$assignment" ]]; then sleep 5; continue; fi

  if [[ "$(jq -r '.approvalRequired // false' <<<"$assignment")" == "true" ]]; then
    approval_task_id=$(jq -r '.taskId' <<<"$assignment")
    approval=$(request "${PALM_BASE_URL}/api/v1/local-runners/tasks/${approval_task_id}/approval" || true)
    approval_status=$(jq -r '.status // "pending"' <<<"$approval")
    echo "Palm is waiting for ${approval_status} approval of a sensitive local action for task ${approval_task_id}."
    sleep 5
    continue
  fi

  if [[ "$(jq -r '.scopeRestricted // false' <<<"$assignment")" == "true" ]]; then
    echo "Palm cannot assign a task to this device: $(jq -r '.reason' <<<"$assignment")"
    sleep 10
    continue
  fi

  run_id=$(jq -r '.runId' <<<"$assignment")
  task_id=$(jq -r '.task.id' <<<"$assignment")
  title=$(jq -r '.task.title' <<<"$assignment")
  prompt=$(jq -r '.task.prompt' <<<"$assignment")
  capabilities=$(jq -r '.capabilityScope | join(", ")' <<<"$assignment")
  tools=$(jq -r '.localToolPolicy.allowedTools | join(", ")' <<<"$assignment")
  has_tool() { [[ ",${tools//, /,}," == *",$1,"* ]]; }
  result_file="${RUNNER_DIR}/palm-task-${task_id}.md"

  report "$run_id" 2 "local.preparing" "running" "Local Runner is preparing the task workspace."
  inventory_file="${RUNNER_DIR}/palm-task-${task_id}-inventory.txt"
  text_metadata_file="${RUNNER_DIR}/palm-task-${task_id}-text-metadata.txt"
  csv_file="${RUNNER_DIR}/palm-task-${task_id}-csv-profile.txt"
  manifest_file="${RUNNER_DIR}/palm-task-${task_id}-manifest.json"
  if has_tool "inventory_files"; then find "$INPUT_DIR" -type f -maxdepth 3 -printf '%p\t%s bytes\n' 2>/dev/null | sort > "$inventory_file" || true; else echo "inventory_files not permitted for this device" > "$inventory_file"; fi
  : > "$text_metadata_file"
  if has_tool "extract_text_metadata"; then while IFS= read -r -d '' text_file; do
    if grep -Iq . "$text_file" 2>/dev/null; then
      {
        echo "File: $text_file"
        echo "Bytes: $(wc -c < "$text_file")"
        echo "Lines: $(wc -l < "$text_file")"
        echo "Preview: $(head -c 180 "$text_file" | tr '\n\r\t' ' ' | tr -s ' ')"
        echo
      } >> "$text_metadata_file"
    fi
  done < <(find "$INPUT_DIR" -type f -maxdepth 3 -print0 2>/dev/null); else echo "extract_text_metadata not permitted for this device" > "$text_metadata_file"; fi
  : > "$csv_file"
  if has_tool "profile_csv"; then while IFS= read -r -d '' csv; do
    { echo "File: $csv"; head -n 1 "$csv"; echo "Rows: $(($(wc -l < "$csv") - 1))"; echo; } >> "$csv_file"
  done < <(find "$INPUT_DIR" -type f -iname '*.csv' -print0 2>/dev/null); else echo "profile_csv not permitted for this device" > "$csv_file"; fi
  jq -n \
    --arg taskId "$task_id" \
    --arg inputBoundary "$INPUT_DIR" \
    --arg outputBoundary "$RUNNER_DIR" \
    --arg inventory "$inventory_file" \
    --arg textMetadata "$text_metadata_file" \
    --arg csvProfile "$csv_file" \
    --arg result "$result_file" \
    '{taskId:$taskId,inputBoundary:$inputBoundary,outputBoundary:$outputBoundary,executedHandlers:["inventory_files","extract_text_metadata","profile_csv","write_result_record"],evidenceFiles:{inventory:$inventory,textMetadata:$textMetadata,csvProfile:$csvProfile,resultRecord:$result},mutationsPerformed:false,networkSharingPerformed:false}' > "$manifest_file"

  cat > "$result_file" <<EOF
# ${title}

## Delegated objective

${prompt}

## Local execution record

- Task ID: ${task_id}
- Runner: user-owned local machine
- Enabled capabilities: ${capabilities}
- Allowlisted file tools: ${tools}
- Input boundary: ${INPUT_DIR}
- Output boundary: ${RUNNER_DIR}
- Safety mode: only read-only inventory and CSV profiling handlers run. No delete, rename, move, overwrite, upload, network sharing, or arbitrary shell command is allowed.

## Local file-processing evidence

- Inventory: ${inventory_file}
- Text metadata: ${text_metadata_file}
- CSV profile: ${csv_file}
- Manifest: ${manifest_file}

## Suggested next action

Review the local evidence files. Any file mutation, external sharing, or script execution must be explicitly approved in Palm.ai and implemented as a separate allowlisted handler.
EOF
  report "$run_id" 3 "local.result_written" "collecting" "Local Runner wrote a task record to ${result_file}."
  report "$run_id" 4 "local.completed" "completed" "Local Runner completed the starter task." "Local Runner completed the task and saved its local execution record to ${result_file}."
  echo "Completed Palm task ${task_id}: ${result_file}"
done
