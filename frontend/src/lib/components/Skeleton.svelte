<script lang="ts">
  interface Props {
    width?: string;
    height?: string;
    borderRadius?: string;
    circle?: boolean;
  }

  let {
    width = "100%",
    height = "16px",
    borderRadius = "4px",
    circle = false
  }: Props = $props();
</script>

<div
  class="skeleton"
  class:circle
  style="width: {width}; height: {height}; border-radius: {circle ? '50%' : borderRadius};"
></div>

<style>
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--bg-tertiary) 25%,
      var(--bg-hover) 50%,
      var(--bg-tertiary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .skeleton.circle {
    flex-shrink: 0;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
