import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Truck,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { categories, products } from "./data/products";
import { changeLanguage } from "./i18n";
import { useCartStore } from "./stores/cartStore";
import type { Category, Product } from "./types";

type SortOption = "featured" | "low" | "high" | "rating";

export default function App() {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const [sort, setSort] = useState<SortOption>("featured");
  const [cartOpen, setCartOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const cartLines = useCartStore((state) => state.lines);
  const addCartLine = useCartStore((state) => state.add);
  const changeCartLine = useCartStore((state) => state.change);
  const clearCart = useCartStore((state) => state.clear);
  const cart = useMemo(() => {
    const lines = cartLines.flatMap((line) => {
      const product = products.find((item) => item.id === line.productId);
      return product ? [{ ...line, product }] : [];
    });
    return {
      lines,
      itemCount: cartLines.reduce((total, line) => total + line.quantity, 0),
      total: lines.reduce((total, line) => total + line.product.price * line.quantity, 0),
      add: addCartLine,
      change: changeCartLine,
      clear: clearCart,
    };
  }, [addCartLine, cartLines, changeCartLine, clearCart]);

  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery = !deferredQuery || `${product.name} ${product.nameZh} ${product.category} ${product.description} ${product.descriptionZh}`.toLowerCase().includes(deferredQuery);
      return matchesCategory && matchesQuery;
    });
    return filtered.toSorted((left, right) => {
      if (sort === "low") return left.price - right.price;
      if (sort === "high") return right.price - left.price;
      if (sort === "rating") return right.rating - left.rating;
      return Number(Boolean(right.badge)) - Number(Boolean(left.badge));
    });
  }, [category, deferredQuery, sort]);

  function addToCart(product: Product) {
    cart.add(product.id);
    setToast(t("toast", { name: localizedProductName(product, i18n.language) }));
    window.setTimeout(() => setToast(null), 2400);
  }

  function browse(categoryName: Category = "All") {
    setCategory(categoryName);
    document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <div className="announcement">
        <span>{t("announcement")}</span>
        <span className="announcement-secondary">{t("returns")}</span>
      </div>
      <Header
        query={query}
        onQueryChange={setQuery}
        cartCount={cart.itemCount}
        onCartOpen={() => setCartOpen(true)}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((open) => !open)}
        onBrowse={browse}
        language={i18n.language === "zh" ? "zh" : "en"}
      />

      <main>
        <Hero onShop={() => browse("All")} onExplore={() => browse("Home")} />
        <TrustStrip />

        <section id="collection" className="collection section-wrap">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t("collection.eyebrow")}</p>
              <h2>{t("collection.title")}</h2>
              <p className="section-copy">{t("collection.copy")}</p>
            </div>
            <button className="filter-trigger" type="button" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal size={17} /> {t("collection.filters")}
            </button>
          </div>

          <div className="category-row" role="tablist" aria-label="Product categories">
            {categories.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={category === item}
                className={category === item ? "category-chip active" : "category-chip"}
                key={item}
                onClick={() => setCategory(item)}
              >
                {t(`category.${item}`)}
              </button>
            ))}
          </div>

          <div className="collection-toolbar">
            <p>{t("collection.count", { count: filteredProducts.length })}</p>
            <label className="sort-select">
              <span>{t("collection.sort")}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
                <option value="featured">{t("collection.featured")}</option>
                <option value="low">{t("collection.low")}</option>
                <option value="high">{t("collection.high")}</option>
                <option value="rating">{t("collection.rating")}</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>

          {filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onView={() => setSelectedProduct(product)}
                  onAdd={() => addToCart(product)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={26} />
              <h3>{t("search.emptyTitle")}</h3>
              <p>{t("search.emptyCopy")}</p>
              <button type="button" className="button dark" onClick={() => { setQuery(""); setCategory("All"); }}>{t("search.reset")}</button>
            </div>
          )}
        </section>

        <EditorialSection onShop={() => browse("Travel")} />
        <Newsletter />
      </main>

      <Footer />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} />
      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        category={category}
        sort={sort}
        onCategory={setCategory}
        onSort={setSort}
      />
      {selectedProduct ? (
        <ProductDialog
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAdd={() => { addToCart(selectedProduct); setSelectedProduct(null); setCartOpen(true); }}
        />
      ) : null}
      {toast ? <div className="toast" role="status"><Check size={16} />{toast}</div> : null}
    </div>
  );
}

function Header({
  query,
  onQueryChange,
  cartCount,
  onCartOpen,
  menuOpen,
  onMenuToggle,
  onBrowse,
  language,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  cartCount: number;
  onCartOpen: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onBrowse: (category?: Category) => void;
  language: "en" | "zh";
}) {
  const { t } = useTranslation();
  return (
    <header className="site-header">
      <div className="header-inner">
        <button type="button" className="mobile-menu-button" onClick={onMenuToggle} aria-label="Toggle menu"><Menu size={21} /></button>
        <button type="button" className="wordmark" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>ATELIER<span>®</span></button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button type="button" onClick={() => onBrowse("All")}>{t("nav.new")}</button>
          <button type="button" onClick={() => onBrowse("Home")}>{t("nav.home")}</button>
          <button type="button" onClick={() => onBrowse("Wear")}>{t("nav.wear")}</button>
          <button type="button" onClick={() => onBrowse("Travel")}>{t("nav.travel")}</button>
        </nav>
        <label className="header-search">
          <Search size={17} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
          {query ? <button type="button" onClick={() => onQueryChange("")} aria-label={t("search.clear")}><X size={14} /></button> : null}
        </label>
        <button type="button" className="language-switch" onClick={() => void changeLanguage(language === "en" ? "zh" : "en")} aria-label={t("language")}>
          {language === "en" ? "中文" : "EN"}
        </button>
        <button type="button" className="bag-button" onClick={onCartOpen} aria-label={t("bag.open", { count: cartCount })}>
          <ShoppingBag size={20} /><span className="bag-label">{t("bag.label")}</span><span className="bag-count">{cartCount}</span>
        </button>
      </div>
      {menuOpen ? (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {(["All", "Home", "Audio", "Wear", "Travel"] as Category[]).map((item) => (
            <button type="button" key={item} onClick={() => { onBrowse(item); onMenuToggle(); }}>{item === "All" ? t("nav.new") : t(`category.${item}`)}<ArrowRight size={16} /></button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function Hero({ onShop, onExplore }: { onShop: () => void; onExplore: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="hero section-wrap">
      <div className="hero-copy">
        <p className="eyebrow">{t("hero.eyebrow")}</p>
        <h1>{t("hero.line1")}<br /><em>{t("hero.line2")}</em></h1>
        <p>{t("hero.copy")}</p>
        <div className="hero-actions">
          <button className="button dark" type="button" onClick={onShop}>{t("hero.shop")} <ArrowRight size={17} /></button>
          <button className="text-link" type="button" onClick={onExplore}>{t("hero.view")}</button>
        </div>
      </div>
      <div className="hero-visual">
        <img src="https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1600&q=90" alt="Calm, modern living room with considered furniture" />
        <div className="hero-product-note">
          <span>01</span>
          <div><strong>{t("hero.noteTitle")}</strong><small>{t("hero.noteCopy")}</small></div>
          <ChevronRight size={17} />
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const { t } = useTranslation();
  const items = [
    { icon: Truck, title: t("trust.delivery"), copy: t("trust.deliveryCopy") },
    { icon: PackageCheck, title: t("trust.packaging"), copy: t("trust.packagingCopy") },
    { icon: ShieldCheck, title: t("trust.warranty"), copy: t("trust.warrantyCopy") },
  ];
  return (
    <section className="trust-strip section-wrap" aria-label="Service benefits">
      {items.map(({ icon: Icon, title, copy }) => (
        <div className="trust-item" key={title}><Icon size={22} /><div><strong>{title}</strong><span>{copy}</span></div></div>
      ))}
    </section>
  );
}

function ProductCard({ product, onView, onAdd }: { product: Product; onView: () => void; onAdd: () => void }) {
  const { t, i18n } = useTranslation();
  const name = localizedProductName(product, i18n.language);
  return (
    <article className="product-card">
      <button className="product-image" type="button" onClick={onView} aria-label={name}>
        <img src={product.image} alt={product.alt} loading="lazy" />
        {product.badge ? <span className="product-badge">{t(`badges.${product.badge}`)}</span> : null}
        <span className="quick-view">{t("collection.quick")}</span>
      </button>
      <div className="product-meta">
        <div className="product-title-row">
          <div><p className="product-category">{t(`category.${product.category}`)}</p><button type="button" onClick={onView}><h3>{name}</h3></button></div>
          <div className="product-price"><strong>${product.price}</strong>{product.compareAt ? <s>${product.compareAt}</s> : null}</div>
        </div>
        <div className="product-bottom">
          <span className="rating"><Star size={13} fill="currentColor" />{product.rating}<small>({product.reviews})</small></span>
          <div className="swatches" aria-label="Available colors">{product.colors.map((color) => <span key={color} style={{ background: color }} />)}</div>
          <button className="add-button" type="button" onClick={onAdd}><Plus size={16} /> {t("collection.add")}</button>
        </div>
      </div>
    </article>
  );
}

function EditorialSection({ onShop }: { onShop: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="editorial section-wrap">
      <div className="editorial-image"><img src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1400&q=85" alt="Traveler wearing timeless neutral clothing" loading="lazy" /></div>
      <div className="editorial-copy">
        <p className="eyebrow">{t("editorial.eyebrow")}</p>
        <h2>{t("editorial.title1")}<br />{t("editorial.title2")}</h2>
        <p>{t("editorial.copy")}</p>
        <button type="button" className="button light" onClick={onShop}>{t("editorial.action")} <ArrowRight size={17} /></button>
      </div>
    </section>
  );
}

function Newsletter() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  return (
    <section className="newsletter section-wrap">
      <Sparkles size={22} />
      <div><p className="eyebrow">{t("newsletter.eyebrow")}</p><h2>{t("newsletter.title")}</h2></div>
      {subscribed ? (
        <p className="newsletter-success"><Check size={17} /> {t("newsletter.success")}</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); if (email) setSubscribed(true); }}>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("newsletter.placeholder")} required aria-label={t("newsletter.placeholder")} />
          <button type="submit">{t("newsletter.join")} <ArrowRight size={16} /></button>
        </form>
      )}
    </section>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="footer section-wrap">
      <div><p className="wordmark footer-logo">ATELIER<span>®</span></p><p>{t("footer.copy")}</p></div>
      <div className="footer-links"><a href="#collection">{t("footer.collection")}</a><a href="#collection">{t("footer.journal")}</a><a href="#collection">{t("footer.about")}</a><a href="#collection">{t("footer.care")}</a></div>
      <p className="copyright">{t("footer.copyright")}</p>
    </footer>
  );
}

type CartApi = {
  lines: Array<{ productId: number; quantity: number; product: Product }>;
  itemCount: number;
  total: number;
  add: (productId: number) => void;
  change: (productId: number, quantity: number) => void;
  clear: () => void;
};

function CartDrawer({ open, onClose, cart }: { open: boolean; onClose: () => void; cart: CartApi }) {
  const { t, i18n } = useTranslation();
  const shippingGap = Math.max(0, 200 - cart.total);
  return (
    <Drawer open={open} onClose={onClose} label={t("bag.title")}>
      <div className="drawer-header"><div><p className="eyebrow">{t("bag.eyebrow")}</p><h2>{t("bag.title")} <span>{cart.itemCount}</span></h2></div><button type="button" onClick={onClose} aria-label={t("bag.title")}><X /></button></div>
      {cart.lines.length ? (
        <>
          <div className="shipping-progress">
            <p>{shippingGap ? t("bag.shippingGap", { amount: shippingGap }) : <><Check size={15} /> {t("bag.shippingReady")}</>}</p>
            <span><i style={{ width: `${Math.min(100, (cart.total / 200) * 100)}%` }} /></span>
          </div>
          <div className="cart-lines">
            {cart.lines.map(({ product, quantity }) => (
              <article className="cart-line" key={product.id}>
                <img src={product.image} alt="" />
                <div><p className="product-category">{t(`category.${product.category}`)}</p><h3>{localizedProductName(product, i18n.language)}</h3><strong>${product.price}</strong>
                  <div className="quantity-control"><button type="button" onClick={() => cart.change(product.id, quantity - 1)} aria-label={t("bag.decrease")}><Minus size={13} /></button><span>{quantity}</span><button type="button" onClick={() => cart.change(product.id, quantity + 1)} aria-label={t("bag.increase")}><Plus size={13} /></button></div>
                </div>
                <button className="remove-line" type="button" onClick={() => cart.change(product.id, 0)} aria-label={t("bag.remove", { name: localizedProductName(product, i18n.language) })}><X size={15} /></button>
              </article>
            ))}
          </div>
          <div className="cart-summary"><div><span>{t("bag.subtotal")}</span><strong>${cart.total.toFixed(2)}</strong></div><p>{t("bag.taxes")}</p><button className="button dark checkout" type="button" onClick={() => window.alert(t("bag.demo"))}>{t("bag.checkout")} <ArrowRight size={17} /></button><button className="clear-cart" type="button" onClick={cart.clear}>{t("bag.clear")}</button></div>
        </>
      ) : (
        <div className="empty-cart"><ShoppingBag size={32} /><h3>{t("bag.emptyTitle")}</h3><p>{t("bag.emptyCopy")}</p><button type="button" className="button dark" onClick={onClose}>{t("bag.browse")}</button></div>
      )}
    </Drawer>
  );
}

function FilterDrawer({ open, onClose, category, sort, onCategory, onSort }: { open: boolean; onClose: () => void; category: Category; sort: SortOption; onCategory: (value: Category) => void; onSort: (value: SortOption) => void }) {
  const { t } = useTranslation();
  return (
    <Drawer open={open} onClose={onClose} label={t("filter.title")}>
      <div className="drawer-header"><div><p className="eyebrow">{t("filter.eyebrow")}</p><h2>{t("filter.title")}</h2></div><button type="button" onClick={onClose} aria-label={t("filter.title")}><X /></button></div>
      <div className="filter-section"><h3>{t("filter.category")}</h3>{categories.map((item) => <label key={item}><input type="radio" checked={category === item} onChange={() => onCategory(item)} /><span>{t(`category.${item}`)}</span></label>)}</div>
      <div className="filter-section"><h3>{t("filter.sort")}</h3>{([['featured', 'collection.featured'], ['low', 'collection.low'], ['high', 'collection.high'], ['rating', 'collection.rating']] as [SortOption, string][]).map(([value, label]) => <label key={value}><input type="radio" checked={sort === value} onChange={() => onSort(value)} /><span>{t(label)}</span></label>)}</div>
      <button type="button" className="button dark apply-filters" onClick={onClose}>{t("filter.action")} <ArrowRight size={17} /></button>
    </Drawer>
  );
}

function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="overlay" role="presentation" onMouseDown={onClose}><aside className="drawer" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => event.stopPropagation()}>{children}</aside></div>;
}

function ProductDialog({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: () => void }) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === "zh";
  const name = localizedProductName(product, i18n.language);
  return (
    <div className="overlay product-overlay" role="presentation" onMouseDown={onClose}>
      <section className="product-dialog" role="dialog" aria-modal="true" aria-label={name} onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close product"><X /></button>
        <div className="dialog-image"><img src={product.image} alt={product.alt} /></div>
        <div className="dialog-copy"><p className="eyebrow">{t(`category.${product.category}`)} · {t("collection.edit")}</p><h2>{name}</h2><div className="dialog-rating"><Star size={15} fill="currentColor" />{product.rating} <span>{t("collection.reviews", { count: product.reviews })}</span></div><p className="dialog-description">{isZh ? product.descriptionZh : product.description}</p><div className="dialog-colors"><span>{t("collection.color")}</span><div>{product.colors.map((color, index) => <button key={color} type="button" className={index === 0 ? "active" : ""} style={{ background: color }} aria-label={`${t("collection.color")} ${index + 1}`} />)}</div></div><ul>{(isZh ? product.detailsZh : product.details).map((detail) => <li key={detail}><Check size={15} />{detail}</li>)}</ul><div className="dialog-buy"><span>${product.price}<small>{t("collection.usd")}</small></span><button type="button" className="button dark" onClick={onAdd}>{t("collection.add")} <ShoppingBag size={17} /></button></div><p className="delivery-note"><Truck size={16} /> {t("collection.ships")}</p></div>
      </section>
    </div>
  );
}

function localizedProductName(product: Product, language: string) {
  return language === "zh" ? product.nameZh : product.name;
}
