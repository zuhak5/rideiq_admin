module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  rules: {
    // Prefer explicit boundaries for client components.
    'react-hooks/exhaustive-deps': 'warn'
  }
};
