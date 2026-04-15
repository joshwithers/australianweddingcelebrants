// Performance optimization script
// Handles lazy loading of non-critical resources and improves Core Web Vitals

// Lazy load images that are not in viewport
function lazyLoadImages() {
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          if (img.dataset.srcset) {
            img.srcset = img.dataset.srcset;
            img.removeAttribute('data-srcset');
          }
          img.classList.remove('lazy');
          observer.unobserve(img);
        }
      });
    }, {
      rootMargin: '50px 0px',
      threshold: 0.01
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }
}

// Preload critical resources
function preloadCriticalResources() {
  // Preload the first few card images that are likely above the fold.
  // Variants: mobile stack → first 3 children; tablet/desktop → first card of each column.
  const criticalImages = document.querySelectorAll(
    '.masonry-grid--mobile > .directory-card-shell:nth-child(-n+3) img, ' +
    '.masonry-grid--tablet .masonry-col > .directory-card-shell:first-child img, ' +
    '.masonry-grid--desktop .masonry-col > .directory-card-shell:first-child img'
  );
  criticalImages.forEach(img => {
    if (img.src && !img.complete) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = img.src;
      document.head.appendChild(link);
    }
  });
}

// Optimize font loading
function optimizeFontLoading() {
  // Use font-display: swap for better performance
  if ('fonts' in document) {
    document.fonts.ready.then(() => {
      document.body.classList.add('fonts-loaded');
    });
  }
}

// Reduce layout shift by setting image dimensions
function preventLayoutShift() {
  const images = document.querySelectorAll('img:not([width]):not([height])');
  images.forEach(img => {
    img.addEventListener('load', function() {
      if (!this.width || !this.height) {
        this.style.aspectRatio = `${this.naturalWidth} / ${this.naturalHeight}`;
      }
    });
  });
}

// Initialize performance optimizations
function initPerformanceOptimizations() {
  // Run immediately
  preloadCriticalResources();
  optimizeFontLoading();
  preventLayoutShift();
  
  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lazyLoadImages);
  } else {
    lazyLoadImages();
  }
}

// Start optimizations
initPerformanceOptimizations();

// Export for use in other modules
export {
  lazyLoadImages,
  preloadCriticalResources,
  optimizeFontLoading,
  preventLayoutShift
};