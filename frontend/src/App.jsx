import React, { useState, useEffect } from 'react';
import { 
  fetchGraphQL, 
  PAPERS_QUERY, 
  INITIAL_DATA_QUERY, 
  ADD_REVIEW_MUTATION, 
  TOGGLE_BOOKMARK_MUTATION, 
  CREATE_PAPER_MUTATION,
  DELETE_PAPER_MUTATION,
  SYNC_EXTERNAL_MUTATION
} from './api';
import { 
  Search, 
  Layers, 
  Activity, 
  Bookmark, 
  Star, 
  PlusCircle, 
  Eye, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  BookOpen, 
  X, 
  Quote,
  Trash2,
  RefreshCw
} from 'lucide-react';

export default function App() {
  const [papers, setPapers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null);

  const [search, setSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);
  const [sortField, setSortField] = useState('publishedYear');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAbstract, setNewAbstract] = useState('');
  const [newSource, setNewSource] = useState('arXiv');
  const [newCategory, setNewCategory] = useState('cat-ai');
  const [newYear, setNewYear] = useState(2026);

  const [readerPaper, setReaderPaper] = useState(null);

  const [activeReviewPaperId, setActiveReviewPaperId] = useState(null);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerRating, setReviewerRating] = useState(5);
  const [reviewerComment, setReviewerComment] = useState('');

  const isAnyModalOpen = Boolean(readerPaper || isCreateOpen || activeReviewPaperId);

  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isAnyModalOpen]);

  const loadInitialData = async () => {
    try {
      const data = await fetchGraphQL(INITIAL_DATA_QUERY);
      setCategories(data.categories || []);
    } catch (err) {
      console.error(err);
    }
  };

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
      showNotice('Ошибка выполнения запроса к Gateway');
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

  const handleSyncFromApi = async () => {
    setSyncing(true);
    try {
      const targetSource = selectedSource || 'ALL';
      const res = await fetchGraphQL(SYNC_EXTERNAL_MUTATION, {
        source: targetSource,
        query: search.trim() || null
      });
      showNotice(res.syncExternalData.message);
      await Promise.all([loadInitialData(), loadPapers()]);
    } catch (err) {
      showNotice('Ошибка синхронизации с внешними API');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleBookmark = async (paperId) => {
    try {
      const res = await fetchGraphQL(TOGGLE_BOOKMARK_MUTATION, { paperId });
      showNotice(res.toggleBookmark.message);
      setPapers(prev => prev.map(p => p.id === paperId ? { ...p, isBookmarked: !p.isBookmarked } : p));
      if (readerPaper && readerPaper.id === paperId) {
        setReaderPaper(prev => ({ ...prev, isBookmarked: !prev.isBookmarked }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenReader = (paper) => {
    setReaderPaper(paper);
    fetchGraphQL(`mutation RecordView($id: ID!) { recordView(paperId: $id) { viewsCount } }`, { id: paper.id })
      .then(() => {
        setPapers(prev => prev.map(p => p.id === paper.id ? { 
          ...p, 
          metrics: { ...p.metrics, viewsCount: (p.metrics?.viewsCount || 0) + 1 } 
        } : p));
      })
      .catch(() => {});
  };

  const handleDownloadPaper = (paper) => {
    const bibtex = `@article{${paper.id},
  title = {${paper.title}},
  source = {${paper.source}},
  year = {${paper.publishedYear}},
  doi = {${paper.doi || '10.1016/' + paper.id}},
  abstract = {${paper.abstract}}
}`;
    const blob = new Blob([bibtex], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${paper.id}-citation.bib`;
    link.click();
    showNotice(`Файл цитирования BibTeX для ${paper.id} успешно скачан!`);
  };

  const handleCopyCitation = (paper) => {
    const citation = `${paper.authors?.map(a => a.author.name).join(', ') || 'Authors'}. (${paper.publishedYear}). "${paper.title}". ${paper.source}. DOI: ${paper.doi || 'N/A'}`;
    navigator.clipboard.writeText(citation);
    showNotice('Цитата скопирована в буфер обмена!');
  };

  const handleDeletePaper = async (paperId) => {
    if (!window.confirm('Вы уверены, что хотите удалить эту публикацию?')) return;
    try {
      const res = await fetchGraphQL(DELETE_PAPER_MUTATION, { id: paperId });
      showNotice(res.deletePaper.message);
      if (readerPaper && readerPaper.id === paperId) {
        setReaderPaper(null);
      }
      loadPapers();
      loadInitialData();
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
      const res = await fetchGraphQL(ADD_REVIEW_MUTATION, {
        input: {
          paperId: activeReviewPaperId,
          reviewerName,
          rating: parseInt(reviewerRating),
          comment: reviewerComment
        }
      });
      showNotice('Отзыв успешно добавлен!');
      setActiveReviewPaperId(null);
      setReviewerName('');
      setReviewerComment('');
      
      if (readerPaper && readerPaper.id === activeReviewPaperId) {
        setReaderPaper(prev => ({
          ...prev,
          reviews: [res.addReview, ...(prev.reviews || [])]
        }));
      }

      loadPapers();
      loadInitialData();
    } catch (err) {
      console.error(err);
    }
  };

  const displayedPapers = onlyBookmarked 
    ? papers.filter(p => p.isBookmarked)
    : papers;

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-badge">
          <Layers size={26} color="#2563eb" />
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.2px' }}>
            ResearchNexus
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className="btn-outline" onClick={handleSyncFromApi} disabled={syncing}>
            <RefreshCw size={15} /> {syncing ? 'Синхронизация...' : `Загрузить из ${selectedSource || 'API'}`}
          </button>
          <button className="btn-primary" onClick={() => setIsCreateOpen(true)}>
            <PlusCircle size={16} /> Опубликовать работу
          </button>
        </div>
      </header>

      {notice && (
        <div style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          color: '#1e40af',
          padding: '10px 16px',
          borderRadius: '4px',
          marginBottom: '18px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <CheckCircle2 size={16} color="#2563eb" />
          <span style={{ fontSize: '13px', fontWeight: 500 }}>{notice}</span>
        </div>
      )}

      <div className="controls-panel">
        <form onSubmit={handleSearchSubmit} className="search-row">
          <input 
            type="text" 
            className="search-input" 
            placeholder="Поиск по статьям, авторам, ключевым словам..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            <Search size={15} /> Найти
          </button>
        </form>

        <div className="filters-row">
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Источник:</span>
          <select value={selectedSource} onChange={(e) => { setSelectedSource(e.target.value); setPage(1); }}>
            <option value="">Все источники</option>
            <option value="OpenAlex">OpenAlex</option>
            <option value="CrossRef">CrossRef</option>
            <option value="EuropePMC">EuropePMC</option>
            <option value="arXiv">arXiv</option>
          </select>

          <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Категория:</span>
          <select value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}>
            <option value="">Все категории ({categories.length})</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>Сортировка:</span>
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

          <button 
            type="button" 
            className="btn-outline"
            style={{ 
              marginLeft: 'auto', 
              backgroundColor: onlyBookmarked ? '#eff6ff' : '#ffffff',
              borderColor: onlyBookmarked ? '#2563eb' : 'var(--border-color)',
              color: onlyBookmarked ? '#2563eb' : 'var(--text-sub)'
            }}
            onClick={() => setOnlyBookmarked(!onlyBookmarked)}
          >
            <Bookmark size={15} fill={onlyBookmarked ? '#2563eb' : 'none'} />
            {onlyBookmarked ? 'Показаны: Закладки' : 'Только сохраненные'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '13.5px', color: 'var(--text-muted)' }}>
          {onlyBookmarked ? (
            <span>Показано сохраненных статей: <strong style={{ color: 'var(--text-main)' }}>{displayedPapers.length}</strong></span>
          ) : (
            <span>Всего найдено: <strong style={{ color: 'var(--text-main)' }}>{totalCount.toLocaleString()}</strong> публикаций</span>
          )}
          {loading && <span style={{ marginLeft: '10px', color: 'var(--accent-blue)' }}>Загрузка...</span>}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Страница {page} из {totalPages}
        </div>
      </div>

      <div className="papers-feed">
        {displayedPapers.length === 0 ? (
          <div style={{ 
            background: '#ffffff', 
            padding: '40px', 
            textAlign: 'center', 
            borderRadius: '8px', 
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)' 
          }}>
            {onlyBookmarked ? 'У вас пока нет сохраненных статей. Нажмите на значок закладки у любой статьи, чтобы добавить ее сюда.' : 'Статьи не найдены.'}
          </div>
        ) : (
          displayedPapers.map((p) => (
            <div key={p.id} className="paper-card">
              <div className="paper-header">
                <div>
                  <div className="paper-meta">
                    <span className="source-tag">{p.source}</span>
                    {p.category && <span className="category-tag">{p.category.name}</span>}
                    <span>Год: <strong>{p.publishedYear}</strong></span>
                    <span>Цитат: <strong>{p.citationsCount}</strong></span>
                    <span>Impact: <strong>{p.impactFactor}</strong></span>
                  </div>
                  <h2 
                    className="paper-title" 
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleOpenReader(p)}
                  >
                    {p.title}
                  </h2>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    onClick={() => handleToggleBookmark(p.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: p.isBookmarked ? '#d97706' : '#94a3b8'
                    }}
                    title={p.isBookmarked ? 'Удалить из закладок' : 'Сохранить в закладки'}
                  >
                    <Bookmark size={20} fill={p.isBookmarked ? '#d97706' : 'none'} />
                  </button>
                  <button 
                    onClick={() => handleDeletePaper(p.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: '2px'
                    }}
                    title="Удалить статью"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <p className="paper-abstract">{p.abstract}</p>

              <div className="authors-list">
                {p.authors && p.authors.map((rel, i) => (
                  <div key={i} className="author-chip">
                    <strong>{rel.author.name}</strong> ({rel.role})
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                <button 
                  className="btn-primary" 
                  style={{ fontSize: '12.5px', padding: '6px 12px' }}
                  onClick={() => handleOpenReader(p)}
                >
                  <BookOpen size={14} /> Читать статью
                </button>
                <button 
                  className="btn-outline" 
                  style={{ fontSize: '12.5px', padding: '6px 12px' }}
                  onClick={() => handleCopyCitation(p)}
                >
                  <Quote size={14} /> Цитировать (APA)
                </button>
              </div>

              <div className="nested-box">
                <div className="metrics-row">
                  <div className="metric-item">
                    <Eye size={15} color="#0284c7" /> Просмотры: <strong>{p.metrics ? p.metrics.viewsCount.toLocaleString() : 0}</strong>
                  </div>
                  <div className="metric-item">
                    <Download size={15} color="#059669" /> Скачивания: <strong>{p.metrics ? p.metrics.downloadsCount.toLocaleString() : 0}</strong>
                  </div>
                  <div className="metric-item" title="Altmetric Score — индекс онлайн-внимания и цитируемости в медиа">
                    <Activity size={15} color="#e11d48" /> Медиа-индекс (Altmetric): <strong>{p.metrics ? p.metrics.altmetricScore : 0}</strong>
                  </div>
                  <div className="metric-item">
                    <Star size={15} color="#d97706" /> Рейтинг: <strong>{p.metrics && p.metrics.averageRating ? p.metrics.averageRating : 'Нет оценок'}</strong>
                  </div>
                  <button 
                    className="btn-outline" 
                    style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => setActiveReviewPaperId(p.id)}
                  >
                    Оставить отзыв
                  </button>
                </div>

                {p.reviews && p.reviews.length > 0 && (
                  <div className="reviews-section">
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      Рецензии экспертов ({p.reviews.length}):
                    </div>
                    {p.reviews.map(rev => (
                      <div key={rev.id} className="review-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '12px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{rev.reviewerName}</span>
                          <span style={{ color: '#d97706' }}>{'★'.repeat(rev.rating)}</span>
                        </div>
                        <p style={{ marginTop: '4px', color: 'var(--text-sub)' }}>{rev.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="pagination-bar">
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
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
          <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{page} / {totalPages}</span>
          <button 
            className="btn-outline" 
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Вперед <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {readerPaper && (
          <div className="modal-overlay" onClick={() => setReaderPaper(null)}>
            <div className="modal-content" style={{ maxWidth: '920px', padding: '36px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '24px' }}>
                <div style={{ paddingRight: '20px' }}>
                  <div className="paper-meta" style={{ marginBottom: '14px' }}>
                    <span className="source-tag">{readerPaper.source}</span>
                    {readerPaper.category && <span className="category-tag">{readerPaper.category.name}</span>}
                    {readerPaper.doi && <span>DOI: <strong>{readerPaper.doi}</strong></span>}
                    <span>Год издания: <strong>{readerPaper.publishedYear}</strong></span>
                    <span>Цитат: <strong>{readerPaper.citationsCount}</strong></span>
                    <span>Импакт-фактор: <strong>{readerPaper.impactFactor}</strong></span>
                  </div>
                  <h2 style={{ fontSize: '23px', fontWeight: 800, color: 'var(--text-main)', lineHeight: '1.4', letterSpacing: '-0.3px' }}>
                    {readerPaper.title}
                  </h2>
                </div>
                <button 
                  onClick={() => setReaderPaper(null)} 
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                >
                  <X size={24} />
                </button>
              </div>

              {readerPaper.authors?.length > 0 && (
                <div style={{ background: '#f8fafc', padding: '16px 20px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '24px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                    Authors & Institutions:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {readerPaper.authors.map((a, i) => (
                      <div key={i} className="author-chip" style={{ background: '#ffffff', padding: '6px 12px', fontSize: '12.5px' }}>
                        <strong style={{ color: 'var(--text-main)' }}>{a.author.name}</strong>
                        {a.author.affiliation && <> • {a.author.affiliation}</>}
                        {a.author.country && <> ({a.author.country})</>}
                        {a.author.hIndex > 0 && <span style={{ color: '#0284c7', marginLeft: '4px' }}>[h-index: {a.author.hIndex}]</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="reader-content" style={{ maxHeight: '60vh' }}>
                <div className="reader-section-title" style={{ marginTop: 0 }}>Abstract</div>
                <p className="reader-paragraph" style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                  {readerPaper.abstract || 'Аннотация отсутствует.'}
                </p>

                <div className="reader-section-title">Publication Metadata</div>
                <ul style={{ paddingLeft: '20px', fontSize: '13.5px', color: 'var(--text-sub)', lineHeight: '1.9', marginBottom: '12px' }}>
                  <li><strong>Источник данных:</strong> {readerPaper.source}</li>
                  {readerPaper.category && <li><strong>Направление:</strong> {readerPaper.category.name} ({readerPaper.category.domain})</li>}
                  <li><strong>Идентификатор записи:</strong> {readerPaper.id}</li>
                  {readerPaper.doi && <li><strong>DOI:</strong> {readerPaper.doi}</li>}
                  {readerPaper.url && (
                    <li>
                      <strong>Оригинал публикации:</strong>{' '}
                      <a href={readerPaper.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)' }}>
                        {readerPaper.url}
                      </a>
                    </li>
                  )}
                </ul>

                {readerPaper.reviews && readerPaper.reviews.length > 0 && (
                  <>
                    <div className="reader-section-title">Рецензии ({readerPaper.reviews.length})</div>
                    {readerPaper.reviews.map(rev => (
                      <div key={rev.id} className="review-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '12px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{rev.reviewerName}</span>
                          <span style={{ color: '#d97706' }}>{'★'.repeat(rev.rating)}</span>
                        </div>
                        <p style={{ marginTop: '4px', color: 'var(--text-sub)' }}>{rev.comment}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {readerPaper.url && (
                    <a
                      href={readerPaper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-outline"
                      style={{ textDecoration: 'none' }}
                    >
                      <BookOpen size={14} /> Открыть оригинал
                    </a>
                  )}
                  <button className="btn-outline" onClick={() => handleCopyCitation(readerPaper)}>
                    <Quote size={14} /> Скопировать цитату (APA)
                  </button>
                  <button className="btn-outline" onClick={() => handleDownloadPaper(readerPaper)}>
                    <Download size={14} /> Скачать BibTeX
                  </button>
                  <button 
                    className="btn-outline"
                    onClick={() => handleToggleBookmark(readerPaper.id)}
                    style={{ color: readerPaper.isBookmarked ? '#d97706' : 'inherit' }}
                  >
                    <Bookmark size={14} fill={readerPaper.isBookmarked ? '#d97706' : 'none'} />
                    {readerPaper.isBookmarked ? 'В закладках' : 'В закладки'}
                  </button>
                </div>

                <button className="btn-primary" onClick={() => { setActiveReviewPaperId(readerPaper.id); }}>
                  Оставить рецензию
                </button>
              </div>
            </div>
          </div>
      )}

      {isCreateOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px', color: 'var(--text-main)' }}>Новая публикация в Catalog Subgraph</h2>
            <form onSubmit={handleCreatePaper}>
              <div className="field-group">
                <label>Название статьи:</label>
                <input 
                  type="text" 
                  required 
                  value={newTitle} 
                  onChange={e => setNewTitle(e.target.value)} 
                  placeholder="Название исследования..."
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div className="field-group">
                  <label>Источник:</label>
                  <select value={newSource} onChange={e => setNewSource(e.target.value)}>
                    <option value="OpenAlex">OpenAlex</option>
                    <option value="CrossRef">CrossRef</option>
                    <option value="EuropePMC">EuropePMC</option>
                    <option value="arXiv">arXiv</option>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
                <button type="button" className="btn-outline" onClick={() => setIsCreateOpen(false)}>Отмена</button>
                <button type="submit" className="btn-primary">Отправить мутацию GraphQL</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeReviewPaperId && (
        <div className="modal-overlay" onClick={() => setActiveReviewPaperId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px', color: 'var(--text-main)' }}>Рецензия на работу {activeReviewPaperId}</h2>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
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
