import { useMemo, useState } from 'react';

const compare = (a, b) => {
  if (a === b) {
    return 0;
  }
  if (a === null || a === undefined) {
    return 1;
  }
  if (b === null || b === undefined) {
    return -1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

export const useTableControls = (rows, { searchFields = [], initialSort = null } = {}) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(initialSort);

  const toggleSort = field => {
    setSort(prev => {
      if (!prev || prev.field !== field) {
        return { field, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { field, direction: 'desc' };
      }
      return null;
    });
  };

  const view = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let result = rows;
    if (needle) {
      result = result.filter(row =>
        searchFields.some(extractor => {
          const value = typeof extractor === 'function' ? extractor(row) : row[extractor];
          if (value === null || value === undefined) {
            return false;
          }
          if (Array.isArray(value)) {
            return value.some(item => String(item).toLowerCase().includes(needle));
          }
          return String(value).toLowerCase().includes(needle);
        })
      );
    }
    if (sort) {
      const sorted = [...result];
      sorted.sort((a, b) => {
        const av = typeof sort.field === 'function' ? sort.field(a) : a[sort.field];
        const bv = typeof sort.field === 'function' ? sort.field(b) : b[sort.field];
        const cmp = compare(av, bv);
        return sort.direction === 'asc' ? cmp : -cmp;
      });
      result = sorted;
    }
    return result;
  }, [rows, search, sort, searchFields]);

  return { search, setSearch, sort, toggleSort, view };
};
