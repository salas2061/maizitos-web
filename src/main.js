import './styles/main.css';
import { renderAdminApp } from './components/admin-app.js';
import { renderPublicApp } from './components/public-app.js';
import { siteContent } from './data/site-content.js';

const root = document.querySelector('#app');

if (window.location.pathname.startsWith('/admin')) {
  renderAdminApp(root, siteContent);
} else {
  renderPublicApp(root, siteContent);
}
