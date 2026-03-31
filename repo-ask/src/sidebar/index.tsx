import { createRoot } from 'react-dom/client';
import SidebarApp from './SidebarApp';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<SidebarApp />);
}
