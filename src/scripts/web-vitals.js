// Web Vitals monitoring for performance tracking
// Tracks Core Web Vitals: LCP, FID, CLS, FCP, TTFB

// Core Web Vitals thresholds
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 }
};

// Performance observer for monitoring metrics
class WebVitalsMonitor {
  constructor() {
    this.metrics = {};
    this.observers = [];
    this.init();
  }

  init() {
    // Only run in browsers that support the APIs
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
      return;
    }

    this.observeLCP();
    this.observeFID();
    this.observeCLS();
    this.observeFCP();
    this.observeTTFB();
  }

  // Largest Contentful Paint
  observeLCP() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        this.recordMetric('LCP', lastEntry.startTime);
      });
      observer.observe({ entryTypes: ['largest-contentful-paint'] });
      this.observers.push(observer);
    } catch (e) {
      console.warn('LCP observation failed:', e);
    }
  }

  // First Input Delay
  observeFID() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          this.recordMetric('FID', entry.processingStart - entry.startTime);
        });
      });
      observer.observe({ entryTypes: ['first-input'] });
      this.observers.push(observer);
    } catch (e) {
      console.warn('FID observation failed:', e);
    }
  }

  // Cumulative Layout Shift
  observeCLS() {
    try {
      let clsValue = 0;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            this.recordMetric('CLS', clsValue);
          }
        });
      });
      observer.observe({ entryTypes: ['layout-shift'] });
      this.observers.push(observer);
    } catch (e) {
      console.warn('CLS observation failed:', e);
    }
  }

  // First Contentful Paint
  observeFCP() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.name === 'first-contentful-paint') {
            this.recordMetric('FCP', entry.startTime);
          }
        });
      });
      observer.observe({ entryTypes: ['paint'] });
      this.observers.push(observer);
    } catch (e) {
      console.warn('FCP observation failed:', e);
    }
  }

  // Time to First Byte
  observeTTFB() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'navigation') {
            this.recordMetric('TTFB', entry.responseStart - entry.requestStart);
          }
        });
      });
      observer.observe({ entryTypes: ['navigation'] });
      this.observers.push(observer);
    } catch (e) {
      console.warn('TTFB observation failed:', e);
    }
  }

  recordMetric(name, value) {
    this.metrics[name] = {
      value: Math.round(value * 100) / 100,
      timestamp: Date.now(),
      rating: this.getRating(name, value)
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`${name}: ${this.metrics[name].value}ms (${this.metrics[name].rating})`);
    }

    this.notifyMetric(name, this.metrics[name]);
  }

  getRating(metric, value) {
    const threshold = THRESHOLDS[metric];
    if (!threshold) return 'unknown';
    
    if (value <= threshold.good) return 'good';
    if (value <= threshold.poor) return 'needs-improvement';
    return 'poor';
  }

  notifyMetric(metric, data) {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent('web-vitals:metric', {
      detail: {
        metric,
        ...data,
        pagePath: window.location.pathname
      }
    }));
  }

  getMetrics() {
    return this.metrics;
  }

  disconnect() {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
  }
}

// Initialize monitoring
const webVitalsMonitor = new WebVitalsMonitor();

// Export for use in other modules
export default webVitalsMonitor;
export { WebVitalsMonitor, THRESHOLDS };

// Global access for debugging
if (typeof window !== 'undefined') {
  window.webVitalsMonitor = webVitalsMonitor;
}
