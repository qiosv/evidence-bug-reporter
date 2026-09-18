import { JSX, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface DemoProduct {
  id: number
  name: string
  status: 'Active' | 'Inactive'
  price: string
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  { id: 1, name: 'Aurora Lamp', status: 'Active', price: '$42' },
  { id: 2, name: 'Nimbus Chair', status: 'Active', price: '$210' },
  { id: 3, name: 'Kepler Desk', status: 'Inactive', price: '$480' },
  { id: 4, name: 'Orbit Mug', status: 'Active', price: '$18' },
  { id: 5, name: 'Quanta Shelf', status: 'Inactive', price: '$95' },
  { id: 6, name: 'Helio Plant', status: 'Active', price: '$24' },
  { id: 7, name: 'Vega Clock', status: 'Active', price: '$64' },
  { id: 8, name: 'Luna Bag', status: 'Inactive', price: '$72' }
]

const PAGE_SIZE = 4
export type StatusFilter = 'All' | 'Active' | 'Inactive'

export function ProductListing(): JSX.Element {
  const [params] = useSearchParams()
  const defectOn = params.get('defect') !== 'off'
  const [filter, setFilter] = useState<StatusFilter>('All')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    if (filter === 'All') return DEMO_PRODUCTS
    return DEMO_PRODUCTS.filter((p) => p.status === filter)
  }, [filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const changeFilter = (next: StatusFilter): void => {
    setFilter(next)
    setPage(1)
  }

  const goToPage = (next: number): void => {
    setPage(next)
    if (defectOn) {
      setFilter('All')
    }
  }

  return (
    <div className="demo-app" data-testid="demo-app">
      <header className="demo-header">
        <div>
          <p className="demo-kicker">Northwind Catalog</p>
          <h1>Product listing</h1>
        </div>
        <p className="demo-mode" data-testid="demo-mode">
          {defectOn ? 'Defect enabled' : 'Defect off'}
        </p>
      </header>

      <section className="demo-toolbar">
        <div>
          <span className="demo-label">Status</span>
          <div className="demo-filters" role="tablist" aria-label="Status filter">
            {(['All', 'Active', 'Inactive'] as StatusFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                data-testid={`filter-${value.toLowerCase()}`}
                className={filter === value ? 'is-selected' : ''}
                aria-selected={filter === value}
                onClick={() => changeFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <p className="demo-selected" data-testid="selected-filter">
          Selected filter: <strong>{filter}</strong>
        </p>
      </section>

      <ul className="demo-grid" data-testid="product-grid">
        {visible.map((product) => (
          <li key={product.id} className="demo-card" data-status={product.status}>
            <span className={`badge ${product.status.toLowerCase()}`}>{product.status}</span>
            <h2>{product.name}</h2>
            <p>{product.price}</p>
          </li>
        ))}
      </ul>

      <nav className="demo-pager" aria-label="Pagination">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            data-testid={`page-${n}`}
            className={safePage === n ? 'is-selected' : ''}
            onClick={() => goToPage(n)}
          >
            Page {n}
          </button>
        ))}
        <span data-testid="page-indicator">Page {safePage} of {pageCount}</span>
      </nav>
    </div>
  )
}
