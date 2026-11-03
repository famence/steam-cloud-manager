// No account data is read. Run before paint to avoid flashing the wrong theme.
try {
  const theme = localStorage.getItem('scm:theme');
  document.documentElement.dataset.theme = theme === 'light' || theme === 'dark'
    ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch { /* The CSS system preference remains the fallback. */ }
