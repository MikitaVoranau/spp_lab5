import React, { useState, useEffect } from 'react';
import { 
  fetchGraphQL, 
  PAPERS_QUERY, 
  INITIAL_DATA_QUERY, 
  ADD_REVIEW_MUTATION, 
  TOGGLE_BOOKMARK_MUTATION, 
  CREATE_PAPER_MUTATION, 
  SYNC_EXTERNAL_MUTATION 
} from './api';
import { 
  Search, 
  Database, 
  Layers, 
  Activity, 
  Bookmark, 
  Star, 
  PlusCircle, 
  RefreshCw, 
  Eye, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  Award,
  Cpu,
  BarChart2,
  CheckCircle2
} from 'lucide-react';

export default function App() {
  // Данные
  const [papers, setPapers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  // Фильтры и пагинация
  const [search, setSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortField, setSortField] = useState('publishedYear');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  // Модальные окна
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAbstract, setNewAbstract] = useState('');
  const [newSource, setNewSource] = useState('arXiv');
  const [newCategory, setNewCategory] = useState('cat-ai');
  const [newYear, setNewYear] = useState(2026);

  // Добавление отзыва
  const [activeReviewPaperId, setActiveReviewPaperId] = useState(null);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerRating, setReviewerRating] = useState(5);
  const [reviewerComment, setReviewerComment] = useState('');

  // Загрузка метаданных (статистика каталога и аналитики)
  const loadInitialData = async () => {
    try {
      const data = await fetchGraphQL(INITIAL_DATA_QUERY);
      setCategories(data.categories || []);
      setStats(data.catalogStats);
      setAnalytics(data.analyticsSummary);
    } catch (err) {
      console.error('Initial data fetch error:', err);
    }
  };

  // Загрузка статей
  const loadPapers = async () => {
    setLoading(true);
    try {
      const filter = {};
      if (search.trim()) filter.search = search.trim();
      if (selectedSource) filter.source = selectedSource;
      if (selectedCategory) filter.categoryId = selectedCategory;

      const sort = { field: sortField, order: sortOrder };

      const data = await fetchGraphQL(PAPERS_QUERY, {
        filter,
        sort,
        page,
        pageSize
      });

      if (data.papers) {
        setPapers(data.papers.items);
        setTotalCount(data.papers.totalCount);
        setTotalPages(data.papers.totalPages);
      }
    } catch (err) {
      console.error('Papers fetch error:', err);
      showNotice('Ошибка выполнения GraphQL запроса к Gateway', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadPapers();
  }, [page, sortField, sortOrder, selectedSource, selectedCategory]);

  const showNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadPapers();
  };

  const handleToggleBookmark = async (paperId) => {
    try {
      const res = await fetchGraphQL(TOGGLE_BOOKMARK_MUTATION, { paperId });
      showNotice(res.toggleBookmark.message);
      // Локально переключить статус
      setPapers(prev => prev.map(p => p.id === paperId ? { ...p, isBookmarked: !p.isBookmarked } : p));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncSource = async (source) => {
    try {
      showNotice(`Синхронизация с ${source}...`);
      const res = await fetchGraphQL(SYNC_EXTERNAL_MUTATION, { source });
      showNotice(res.syncExternalData.message);
      loadInitialData();
      loadPapers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreatePaper = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchGraphQL(CREATE_PAPER_MUTATION, {
        input: {
          title: newTitle,
          abstract: newAbstract,
          source: newSource,
          categoryId: newCategory,
          publishedYear: parseInt(newYear)
        }
      });
      showNotice(res.createPaper.message);
      setIsCreateOpen(false);
      setNewTitle('');
      setNewAbstract('');
      loadInitialData();
      loadPapers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddReview = async (e) => {
    e.preventDefault();
    try {
      await fetchGraphQL(ADD_REVIEW_MUTATION, {
        input: {
          paperId: activeReviewPaperId,
          reviewerName,
          rating: parseInt(reviewerRating),
          comment: reviewerComment
        }
      });
      showNotice('Отзыв успешно добавлен в Analytics Subgraph!');
      setActiveReviewPaperId(null);
      setReviewerName('');
      setReviewerComment('');
      loadPapers();
      loadInitialData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-badge">
          <Layers size={28} color="#6366f1" />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700 }}>ResearchNexus GraphQL</h1>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Apollo Federation 2.0 • Distributed Scientific Architecture
            </p>
          </div>
          <span className="badge-tag">Federated Supergraph</span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-outline" onClick={() => window.open('http://localhost:4000/metrics', '_blank')}>
            <BarChart2 size={16} /> Prometheus Metrics
          </button>
          <button className="btn-primary" onClick={() => setIsCreateOpen(true)}>
            <PlusCircle size={16} /> Опубликовать работу
          </button>
        </div>
      </header>

      {/* Notice Banner */}
      {notice && (
        <div style={{
          background: 'rgba(99, 102, 241, 0.2)',
          border: '1px solid var(--accent-indigo)',
          color: '#e0e7ff',
          padding: '12px 20px',
          borderRadius: '10px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <CheckCircle2 size={18} color="#818cf8" />
          <span>{notice}</span>
        </div>
      )}

      {/* KPI Stats Bar */}
      <div className="stats-grid">
        <div className="stat-card">
          <div>
            <div className="stat-val">{stats ? stats.totalPapers.toLocaleString() : '12,000+'}</div>
            <div className="stat-label">Публикаций в Catalog Subgraph</div>
          </div>
          <Database size={24} color="#6366f1" />
        </div>

        <div className="stat-card">
          <div>
            <div className="stat-val">{stats ? stats.totalAuthors.toLocaleString() : '1,500'}</div>
            <div className="stat-label">Ученых и исследователей</div>
          </div>
          <Award size={24} color="#06b6d4" />
        </div>

        <div className="stat-card">
          <div>
            <div className="stat-val">{analytics ? analytics.totalViews.toLocaleString() : '---'}</div>
            <div className="stat-label">Просмотров в Analytics Subgraph</div>
          </div>
          <Eye size={24} color="#10b981" />
        </div>

        <div className="stat-card">
          <div>
            <div className="stat-val">{analytics ? analytics.averageSystemRating : '4.6'} ★</div>
            <div className="stat-label">Средний рейтинг публикаций</div>
          </div>
          <Star size={24} color="#f59e0b" />
        </div>
      </div>

      {/* Filter and Control Panel */}
      <div className="controls-panel">
        <form onSubmit={handleSearchSubmit} className="search-row">
          <input 
            type="text" 
            className="search-input" 
            placeholder="Поиск по 12,000+ статьям, темам и абстрактам..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            <Search size={16} /> Найти
          </button>
        </form>

        <div className="filters-row">
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Источник:</span>
          <select value={selectedSource} onChange={(e) => { setSelectedSource(e.target.value); setPage(1); }}>
            <option value="">Все источники (3 интеграции)</option>
            <option value="arXiv">arXiv</option>
            <option value="OpenAlex">OpenAlex</option>
            <option value="SemanticScholar">SemanticScholar</option>
          </select>

          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Категория:</span>
          <select value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}>
            <option value="">Все категории ({categories.length})</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.papersCount})</option>
            ))}
          </select>

          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Сортировка:</span>
          <select value={sortField} onChange={(e) => setSortField(e.target.value)}>
            <option value="publishedYear">Год публикации</option>
            <option value="citationsCount">Цитируемость</option>
            <option value="impactFactor">Импакт-фактор</option>
            <option value="title">Название</option>
          </select>

          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="DESC">По убыванию</option>
            <option value="ASC">По возрастанию</option>
          </select>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button className="btn-outline" onClick={() => handleSyncSource('arXiv')} title="Собрать новые статьи из arXiv">
              <RefreshCw size={14} /> arXiv Sync
            </button>
            <button className="btn-outline" onClick={() => handleSyncSource('OpenAlex')} title="Собрать новые статьи из OpenAlex">
              <RefreshCw size={14} /> OpenAlex Sync
            </button>
          </div>
        </div>
      </div>

      {/* Results Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Найдено записей: <strong style={{ color: '#fff' }}>{totalCount.toLocaleString()}</strong> 
          {loading && <span style={{ marginLeft: '10px', color: 'var(--accent-cyan)' }}>Обновление данных через Federation Gateway...</span>}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Страница {page} из {totalPages}
        </div>
      </div>

      {/* Papers Feed */}
      <div className="papers-feed">
        {papers.map((p) => (
          <div key={p.id} className="paper-card">
            <div className="paper-header">
              <div>
                <div className="paper-meta">
                  <span className="source-tag">{p.source}</span>
                  {p.category && <span className="category-tag">{p.category.name} ({p.category.domain})</span>}
                  <span>Год: <strong>{p.publishedYear}</strong></span>
                  <span>Цитат: <strong>{p.citationsCount}</strong></span>
                  <span>Impact: <strong>{p.impactFactor}</strong></span>
                </div>
                <h2 className="paper-title">{p.title}</h2>
              </div>
              <button 
                onClick={() => handleToggleBookmark(p.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: p.isBookmarked ? '#f59e0b' : 'var(--text-muted)'
                }}
                title={p.isBookmarked ? 'В закладках' : 'Добавить в закладки'}
              >
                <Bookmark size={22} fill={p.isBookmarked ? '#f59e0b' : 'none'} />
              </button>
            </div>

            <p className="paper-abstract">{p.abstract}</p>

            {/* Авторы (Вложенность 2 уровня: Paper -> authors -> author) */}
            <div className="authors-list">
              {p.authors && p.authors.map((rel, i) => (
                <div key={i} className="author-chip" title={`${rel.author.affiliation} • ${rel.author.country} • h-index: ${rel.author.hIndex}`}>
                  <strong>{rel.author.name}</strong> ({rel.role})
                </div>
              ))}
            </div>

            {/* Метрики и отзывы из сабграфа Analytics (Federation resolve) */}
            <div className="nested-box">
              <div className="metrics-row">
                <div className="metric-item">
                  <Eye size={15} color="#06b6d4" /> Просмотры: <strong>{p.metrics ? p.metrics.viewsCount.toLocaleString() : 0}</strong>
                </div>
                <div className="metric-item">
                  <Download size={15} color="#10b981" /> Скачивания: <strong>{p.metrics ? p.metrics.downloadsCount.toLocaleString() : 0}</strong>
                </div>
                <div className="metric-item">
                  <Activity size={15} color="#f43f5e" /> Altmetric: <strong>{p.metrics ? p.metrics.altmetricScore : 0}</strong>
                </div>
                <div className="metric-item">
                  <Star size={15} color="#f59e0b" /> Рейтинг: <strong>{p.metrics && p.metrics.averageRating ? p.metrics.averageRating : 'Нет оценок'}</strong>
                </div>
                <button 
                  className="btn-outline" 
                  style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => setActiveReviewPaperId(p.id)}
                >
                  Оставить отзыв
                </button>
              </div>

              {/* Отзывы */}
              {p.reviews && p.reviews.length > 0 && (
                <div className="reviews-section">
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Рецензии экспертов ({p.reviews.length}):
                  </div>
                  {p.reviews.map(rev => (
                    <div key={rev.id} className="review-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '12px' }}>
                        <span><strong>{rev.reviewerName}</strong></span>
                        <span style={{ color: '#f59e0b' }}>{'★'.repeat(rev.rating)}</span>
                      </div>
                      <p style={{ marginTop: '4px', color: '#e2e8f0' }}>{rev.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Bar */}
      <div className="pagination-bar">
        <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Показано {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalCount)} из {totalCount.toLocaleString()}
        </div>
        <div className="pagination-controls">
          <button 
            className="btn-outline" 
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            <ChevronLeft size={16} /> Назад
          </button>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{page} / {totalPages}</span>
          <button 
            className="btn-outline" 
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Вперед <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Modal: Добавить публикацию (Мутация Catalog) */}
      {isCreateOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '18px' }}>Новая публикация в Catalog Subgraph</h2>
            <form onSubmit={handleCreatePaper}>
              <div className="field-group">
                <label>Название статьи:</label>
                <input 
                  type="text" 
                  required 
                  value={newTitle} 
                  onChange={e => setNewTitle(e.target.value)} 
                  placeholder="e.g. Distributed Consensus in Federated GraphQL Systems"
                />
              </div>

              <div className="field-group">
                <label>Аннотация (Abstract):</label>
                <textarea 
                  rows={4} 
                  required 
                  value={newAbstract} 
                  onChange={e => setNewAbstract(e.target.value)}
                  placeholder="Краткое изложение работы и результатов исследования..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div className="field-group">
                  <label>Источник:</label>
                  <select value={newSource} onChange={e => setNewSource(e.target.value)}>
                    <option value="arXiv">arXiv</option>
                    <option value="OpenAlex">OpenAlex</option>
                    <option value="SemanticScholar">SemanticScholar</option>
                  </select>
                </div>

                <div className="field-group">
                  <label>Категория:</label>
                  <select value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label>Год:</label>
                  <input 
                    type="number" 
                    value={newYear} 
                    onChange={e => setNewYear(e.target.value)} 
                    min={2000} 
                    max={2026}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button type="button" className="btn-outline" onClick={() => setIsCreateOpen(false)}>Отмена</button>
                <button type="submit" className="btn-primary">Отправить мутацию GraphQL</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Добавить рецензию (Мутация Analytics) */}
      {activeReviewPaperId && (
        <div className="modal-overlay" onClick={() => setActiveReviewPaperId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '18px' }}>Рецензия на работу {activeReviewPaperId}</h2>
            <form onSubmit={handleAddReview}>
              <div className="field-group">
                <label>ФИО Рецензента:</label>
                <input 
                  type="text" 
                  required 
                  value={reviewerName} 
                  onChange={e => setReviewerName(e.target.value)}
                  placeholder="Проф. Смирнов А.В." 
                />
              </div>

              <div className="field-group">
                <label>Оценка (1-5 звезд):</label>
                <select value={reviewerRating} onChange={e => setReviewerRating(e.target.value)}>
                  <option value={5}>5 ★ - Выдающееся исследование</option>
                  <option value={4}>4 ★ - Качественная работа</option>
                  <option value={3}>3 ★ - Удовлетворительно</option>
                  <option value={2}>2 ★ - Требует доработки</option>
                  <option value={1}>1 ★ - Отклонить</option>
                </select>
              </div>

              <div className="field-group">
                <label>Комментарий рецензента:</label>
                <textarea 
                  rows={4} 
                  required 
                  value={reviewerComment} 
                  onChange={e => setReviewerComment(e.target.value)}
                  placeholder="Опишите новизну, методологию и вклад авторов..."
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button type="button" className="btn-outline" onClick={() => setActiveReviewPaperId(null)}>Отмена</button>
                <button type="submit" className="btn-primary">Сохранить рецензию</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
