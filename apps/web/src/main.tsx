import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('HomeMew root element not found');
}

// An old staging URL must not silently start writing to production after the route was retired.
const retiredStagingUrl = new URLSearchParams(window.location.search).get('env') === 'staging';

createRoot(root).render(retiredStagingUrl ? (
  <main role="alert" style={{ maxWidth: 620, margin: '12vh auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
    <h1>旧测试入口已停用</h1>
    <p>不再通过 URL 参数切换环境。请使用 HomeMew Web Preview 测试 LifeSpace Staging，或打开不带参数的正式网站。</p>
    <a href="/">进入 HomeMew Production</a>
  </main>
) : (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
));
