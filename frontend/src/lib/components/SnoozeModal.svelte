<script lang="ts">
  import { AlarmClock } from "@lucide/svelte";
  import { emailActions } from "$lib/stores";
  import WhenPicker from "./WhenPicker.svelte";

  interface Props {
    emailId: string;
    onClose: () => void;
  }

  let { emailId, onClose }: Props = $props();

  function snooze(timestamp: number) {
    emailActions.snooze(emailId, timestamp);
    onClose();
  }
</script>

<WhenPicker title="Snooze until..." icon={AlarmClock} confirmLabel="Snooze" onPick={snooze} {onClose} />
