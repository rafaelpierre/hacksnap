export function observeRecommendationExposure(
  element: Element,
  onExposure: () => void,
  Observer: typeof IntersectionObserver = IntersectionObserver,
): () => void {
  const observer = new Observer(entries => {
    if (entries.some(entry => entry.intersectionRatio >= 0.5)) {
      onExposure();
      observer.disconnect();
    }
  }, {threshold: 0.5});
  observer.observe(element);
  return () => observer.disconnect();
}
