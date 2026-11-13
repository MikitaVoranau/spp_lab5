export async function fetchGraphQL(query, variables = {}) {
  const response = await fetch('http://localhost:4000/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  const json = await response.json();
  if (json.errors && json.errors.length > 0) {
    const error = new Error(json.errors[0].message);
    error.graphQLErrors = json.errors;
    throw error;
  }
  return json.data;
}

// Запрос списка статей с пагинацией, фильтрацией и вложенными полями сабграфов
export const PAPERS_QUERY = `
  query GetPapers(
    $filter: PaperFilterInput,
    $sort: PaperSortInput,
    $page: Int,
    $pageSize: Int
  ) {
    papers(filter: $filter, sort: $sort, page: $page, pageSize: $pageSize) {
      totalCount
      page
      pageSize
      totalPages
      items {
        id
        title
        abstract
        source
        citationsCount
        impactFactor
        publishedYear
        doi
        url
        category {
          id
          name
          domain
        }
        authors {
          role
          author {
            id
            name
            affiliation
            country
            hIndex
          }
        }
        metrics {
          viewsCount
          downloadsCount
          altmetricScore
          averageRating
        }
        reviews {
          id
          reviewerName
          rating
          comment
          createdAt
        }
        isBookmarked
      }
    }
  }
`;

// Запрос категорий и статистики каталога
export const INITIAL_DATA_QUERY = `
  query GetInitialData {
    categories {
      id
      name
      domain
      papersCount
    }
    catalogStats {
      totalPapers
      totalAuthors
      totalCategories
      sources {
        source
        count
      }
    }
    analyticsSummary {
      totalViews
      totalDownloads
      totalReviews
      averageSystemRating
    }
    bookmarks {
      id
      paperId
      tag
      createdAt
    }
  }
`;

// Мутация добавления рецензии (в analytics сабграф)
export const ADD_REVIEW_MUTATION = `
  mutation AddReview($input: AddReviewInput!) {
    addReview(input: $input) {
      id
      reviewerName
      rating
      comment
      createdAt
    }
  }
`;

// Мутация добавления/снятия закладки
export const TOGGLE_BOOKMARK_MUTATION = `
  mutation ToggleBookmark($paperId: ID!, $tag: String) {
    toggleBookmark(paperId: $paperId, tag: $tag) {
      success
      message
    }
  }
`;

// Мутация создания статьи (в catalog сабграф)
export const CREATE_PAPER_MUTATION = `
  mutation CreatePaper($input: CreatePaperInput!) {
    createPaper(input: $input) {
      success
      message
      paper {
        id
        title
        publishedYear
      }
    }
  }
`;

// Мутация симуляции синхронизации данных из внешнего источника
export const SYNC_EXTERNAL_MUTATION = `
  mutation SyncExternal($source: String!) {
    syncExternalData(source: $source) {
      success
      message
    }
  }
`;
