try {
  const saved = localStorage.getItem('cali-theme')
  const preference = saved === 'light' || saved === 'dark' ? saved : 'system'
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0C202B' : '#F6FCFF'
} catch {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0C202B' : '#F6FCFF'
}
