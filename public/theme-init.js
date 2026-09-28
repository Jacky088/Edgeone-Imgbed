// 主题初始化：必须在首帧渲染前同步执行，否则暗色用户刷新时会先闪白屏。
// （index.html 以 <script src> 引入；独立文件使 CSP 可以去掉 unsafe-inline）
;(function () {
  try {
    var t = localStorage.getItem('theme')
    if (t !== 'dark' && t !== 'light') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.classList.add(t)
  } catch (e) {
    document.documentElement.classList.add('light')
  }
})()
