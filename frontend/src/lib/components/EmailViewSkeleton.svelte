<script lang="ts">
  import Skeleton from "./Skeleton.svelte";
</script>

<!-- Matches the structure and layout of EmailView.svelte -->
<div class="email-view-skeleton">
  <header class="header">
    <div class="back-btn">
      <Skeleton width="60px" height="20px" />
    </div>
    <div class="actions">
      <Skeleton width="80px" height="32px" borderRadius="6px" />
      <Skeleton width="60px" height="32px" borderRadius="6px" />
      <Skeleton width="70px" height="32px" borderRadius="6px" />
      <Skeleton width="60px" height="32px" borderRadius="6px" />
    </div>
  </header>

  <div class="content">
    <!-- Subject -->
    <div class="subject">
      <Skeleton width="70%" height="28px" />
    </div>

    <!-- Sender info with avatar -->
    <div class="meta">
      <div class="sender-info">
        <Skeleton width="40px" height="40px" circle />
        <div class="sender-details">
          <Skeleton width="150px" height="16px" />
          <Skeleton width="200px" height="14px" />
        </div>
      </div>
      <div class="date">
        <Skeleton width="180px" height="14px" />
      </div>
    </div>

    <!-- Recipients -->
    <div class="recipients">
      <Skeleton width="250px" height="14px" />
    </div>

    <!-- Email body skeleton -->
    <div class="body">
      <Skeleton width="100%" height="16px" />
      <Skeleton width="95%" height="16px" />
      <Skeleton width="88%" height="16px" />
      <Skeleton width="100%" height="16px" />
      <Skeleton width="70%" height="16px" />
      <div class="paragraph-gap"></div>
      <Skeleton width="100%" height="16px" />
      <Skeleton width="92%" height="16px" />
      <Skeleton width="85%" height="16px" />
      <Skeleton width="60%" height="16px" />
      <div class="paragraph-gap"></div>
      <Skeleton width="45%" height="16px" />
    </div>
  </div>
</div>

<style>
  .email-view-skeleton {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .back-btn {
    padding: 8px 0;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
    max-width: 900px;
  }

  .subject {
    margin-bottom: 24px;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .sender-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .sender-details {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .date {
    display: flex;
    justify-content: flex-end;
  }

  .recipients {
    margin-bottom: 24px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    line-height: 1.6;
  }

  .paragraph-gap {
    height: 8px;
  }
</style>
