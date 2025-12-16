<script lang="ts">
  import Skeleton from "./Skeleton.svelte";
</script>

<!-- Matches the structure and dimensions of EmailRow.svelte -->
<div class="email-row-skeleton">
  <!-- Star placeholder -->
  <div class="star">
    <Skeleton width="16px" height="16px" borderRadius="2px" />
  </div>

  <!-- Sender placeholder (180px width like original) -->
  <div class="sender">
    <Skeleton width="120px" height="14px" />
  </div>

  <!-- Content: subject, separator, snippet -->
  <div class="content">
    <Skeleton width="180px" height="14px" />
    <span class="separator"></span>
    <Skeleton width="100%" height="14px" />
  </div>

  <!-- Date placeholder (70px width like original) -->
  <div class="date">
    <Skeleton width="50px" height="12px" />
  </div>
</div>

<style>
  .email-row-skeleton {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    height: 46px; /* Match EmailRow height for virtual list */
    box-sizing: border-box;
  }

  .star {
    flex-shrink: 0;
    width: 16px;
  }

  .sender {
    width: 180px;
    flex-shrink: 0;
  }

  .content {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    min-width: 0;
  }

  .separator {
    width: 16px;
    flex-shrink: 0;
  }

  .date {
    flex-shrink: 0;
    width: 70px;
    display: flex;
    justify-content: flex-end;
  }
</style>
