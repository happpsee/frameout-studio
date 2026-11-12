import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadDesktopStorage } from './lib/desktop-storage';
import { loadRememberedKeys } from './lib/secrets';
import './styles/app.css';
import './styles/studio.css';
import './styles/select-control.css';
import './styles/ai-settings.css';
import './styles/motion.css';
import './styles/react.css';
import './styles/workflow.css';
import './styles/desktop.css';



if (window.frameoutDesktop?.platform === 'darwin') 
  document.documentElement.dataset.desktopPlatform = 'darwin';


const root = ReactDOM.createRoot(document.getElementById('root')!);
const render = () => root.render(<React.StrictMode><App /></React.StrictMode>);

if (window.frameoutDesktop) {
  void Promise.all([loadDesktopStorage(), loadRememberedKeys()]).then(render, () => {
    root.render(<main style={{ padding: 32 }}>
      <h1>项目读取失败</h1>
      <p>请检查应用数据目录是否可读，再重试。</p>
      <button type="button" onClick={() => location.reload()}>重试</button>
      </main>);
  });
} else render();
