module.exports = {
  ci: {
    collect: {
      startServerCommand: 'node scripts/serve.mjs',
      startServerReadyPattern: 'Serving',
      url: ['http://localhost:8080/'],
      numberOfRuns: 1,
      settings: { chromeFlags: '--no-sandbox --headless=new' }
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:seo': ['warn', { minScore: 0.8 }]
      }
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' }
  }
};
