import type { ReactNode } from 'react'
import { NavLink, Link, useLocation } from 'react-router'
import { House, Images, ShoppingBag, LogOut } from 'lucide-react'
import './Layout.css'

const links = [
  { to: '/', label: 'HOME', icon: House },
  { to: '/collections', label: 'COLLECTIONS', icon: Images },
  { to: '/purchasing', label: 'IMAGES FOR PURCHASE', icon: ShoppingBag },
]

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()

  // Keep the full sidebar on the Home page.
  const isHomePage = location.pathname === '/'

  return (
    <div className={`app-shell ${isHomePage ? 'app-shell-home' : 'app-shell-collapsible'}`}>

      {/* Shared sidebar */}
      <aside className="site-sidebar">

        {/* Photographer branding */}
        <div className="site-sidebar-brand">
          <h2>John Doe</h2>
          <p>PHOTOGRAPHY</p>
        </div>

        {/* Navigation */}
        <nav className="site-sidebar-navigation" aria-label="Main navigation">
          {links.map((link) => {
            const Icon = link.icon

            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                title={link.label}
                className={({ isActive }) =>
                  `site-sidebar-link${isActive ? ' site-sidebar-link-active' : ''}`
                }
              >
                <Icon className="site-sidebar-icon" size={20} strokeWidth={1.5} />
                <span className="site-sidebar-label">{link.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Logout */}
        <Link to="/login" className="site-sidebar-logout" title="LOGOUT">
          <LogOut className="site-sidebar-icon" size={20} strokeWidth={1.5} />
          <span className="site-sidebar-label">LOGOUT</span>
        </Link>

      </aside>

      {/* Page content */}
      <main className="site-main">
        {children}
      </main>

    </div>
  )
}