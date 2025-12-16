<script lang="ts">
  import Skeleton from "./Skeleton.svelte";
</script>

<!-- Matches the structure of DraftList and ScheduledList row items -->
<div class="draft-row-skeleton">
  <div class="header">
    <Skeleton width="200px" height="14px" />
    <Skeleton width="60px" height="12px" />
  </div>
  <Skeleton width="250px" height="13px" />
  <Skeleton width="100%" height="12px" />
</div>

<style>
  .draft-row-skeleton {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
</style>
