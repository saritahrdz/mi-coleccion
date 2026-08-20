const initialItems = {
  vinyls: [],
  cds: [],
  movies: [],
  books: []
};

const labels = { vinyls: 'Side A / Side B', cds: 'Digital, but tactile', movies: 'Lights down / eyes up', books: 'Pages, worn and waiting' };
const titles = { vinyls: 'The vinyl shelf', cds: 'The CD shelf', movies: 'The film shelf', books: 'The book shelf' };
const storageKey = 'mi-coleccion';
const supabaseClient = window.supabaseConfig?.url && window.supabaseConfig?.anonKey
  ? window.supabase.createClient(window.supabaseConfig.url, window.supabaseConfig.anonKey)
  : null;
let collection;

try {
  const sourceCollection = window.collectionData || initialItems;
  const storedCollection = JSON.parse(localStorage.getItem(storageKey)) || {};
  collection = structuredClone(sourceCollection);
  Object.keys(initialItems).forEach((type) => {
    const storedItems = Array.isArray(storedCollection[type]) ? storedCollection[type] : [];
    const sourceItems = Array.isArray(collection[type]) ? collection[type] : [];
    const storedKeys = new Set(storedItems.map((item) => `${item.title}\u0000${item.creator}`));
    collection[type] = [
      ...sourceItems.filter((item) => !storedKeys.has(`${item.title}\u0000${item.creator}`)),
      ...storedItems
    ];
  });
} catch (error) {
  collection = structuredClone(initialItems);
}
Object.keys(initialItems).forEach((type) => {
  if (!Array.isArray(collection[type])) collection[type] = [];
});

async function saveCollection(item, type) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(collection));
    if (supabaseClient) {
      const payload = {
        type,
        title: item.title,
        creator: item.creator,
        year: item.year,
        image: item.image,
        color: item.color || '',
        edition: item.edition || '',
        format: item.format || ''
      };
      const query = item.id
        ? supabaseClient.from('collection_items').update(payload).eq('id', item.id).select().single()
        : supabaseClient.from('collection_items').insert(payload).select().single();
      const { data, error } = await query;
      if (error) throw error;
      item.id = data.id;
    }
    return true;
  } catch (error) {
    console.error('Could not save the collection.', error);
    const detail = error?.message || error?.details || 'Unknown error';
    window.alert(`Could not save the collection: ${detail}`);
    return false;
  }
}

async function loadRemoteCollection() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from('collection_items')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!data.length) {
    const seedItems = Object.entries(collection).flatMap(([type, entries]) => entries.map((item) => ({ ...item, type })));
    if (seedItems.length) {
      const { error: seedError } = await supabaseClient.from('collection_items').insert(seedItems);
      if (seedError) throw seedError;
      return loadRemoteCollection();
    }
  }
  collection = structuredClone(initialItems);
  data.forEach(({ id, type, ...item }) => {
    if (collection[type]) collection[type].push({ id, ...item });
  });
}
let activeType = 'vinyls';
let editingIndex = null;
let editingType = null;
let sourceFileHandle = null;

const grid = document.querySelector('#collectionGrid');
const emptyState = document.querySelector('#emptyState');
const searchInput = document.querySelector('#searchInput');
const form = document.querySelector('#addForm');

function requireEditorAccess() {
  const password = window.prompt('Enter the editor password:');
  if (password !== window.supabaseConfig?.editorPassword) {
    window.alert('That password is not correct.');
    return false;
  }
  return true;
}

function configureForm(type) {
  const fieldRules = {
    vinyls: { title: 'Vinyl title', titlePlaceholder: 'e.g. Love Deluxe', creator: 'Artist', placeholder: 'e.g. Sade', year: 'Year', visible: ['colorField'], required: [] },
    cds: { title: 'CD title', titlePlaceholder: 'e.g. Koi No Yokan', creator: 'Artist', placeholder: 'e.g. Deftones', year: 'Year', visible: [], required: [] },
    movies: { title: 'Movie title', titlePlaceholder: 'e.g. The Matrix', creator: 'Director', placeholder: 'e.g. The Wachowskis', year: 'Release year', visible: ['editionField', 'formatField'], required: ['editionField', 'formatField'] },
    books: { title: 'Book title', titlePlaceholder: 'e.g. The Unworthy', creator: 'Author', placeholder: 'e.g. Augustina Bazterrica', year: 'Year', visible: ['bookEditionField'], required: ['bookEditionField'] }
  }[type];
  const titleField = document.querySelector('#titleField');
  titleField.firstChild.textContent = fieldRules.title;
  titleField.querySelector('input').placeholder = fieldRules.titlePlaceholder;
  const creatorField = document.querySelector('#creatorField');
  const yearField = document.querySelector('#yearField');
  creatorField.firstChild.textContent = fieldRules.creator;
  creatorField.querySelector('input').placeholder = fieldRules.placeholder;
  yearField.firstChild.textContent = fieldRules.year;

  ['colorField', 'editionField', 'bookEditionField', 'formatField'].forEach((fieldId) => {
    const field = document.querySelector(`#${fieldId}`);
    const control = field.querySelector('input, select');
    const visible = fieldRules.visible.includes(fieldId);
    field.hidden = !visible;
    control.disabled = !visible;
    control.required = fieldRules.required.includes(fieldId);
    if (!visible) control.value = '';
  });
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const items = collection[activeType]
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => `${item.title} ${item.creator} ${item.year} ${item.edition || ''} ${item.format || ''} ${item.color || ''}`.toLowerCase().includes(query));
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.querySelector('span').textContent = String(collection[tab.dataset.type].length).padStart(2, '0');
  });
  const totalItems = Object.values(collection).reduce((total, items) => total + items.length, 0);
  document.querySelector('#archiveCount').textContent = String(totalItems).padStart(2, '0');
  document.querySelector('#sectionEyebrow').textContent = labels[activeType];
  document.querySelector('#sectionTitle').textContent = titles[activeType];
  document.querySelector('#visibleCount').textContent = String(items.length).padStart(2, '0');
  grid.innerHTML = items.map(({ item, index }) => `
    <article class="media-card ${activeType === 'movies' ? 'movie-card' : activeType === 'books' ? 'book-card' : ''}" style="animation-delay: ${index * 55}ms">
      <div class="cover-wrap"><img src="${item.image}" alt="${item.title} cover art" loading="lazy"></div>
      <div class="card-info">
        <div><h3 class="card-title">${item.title}</h3><p class="card-creator">${item.creator}</p>${activeType === 'vinyls' && item.color ? `<p class="card-detail">${item.color}</p>` : ''}${(activeType === 'movies' || activeType === 'books') && item.edition ? `<p class="card-detail">${item.edition}</p>` : ''}</div>
        <span class="card-year">${item.year}</span>
      </div>
      <div class="card-footer"><span class="type-label">${activeType.slice(0, -1)}</span><div class="card-actions"><button class="edit-button" type="button" data-index="${index}" aria-label="Edit ${item.title}" title="Edit item">✎</button><button class="delete-button" type="button" data-index="${index}" aria-label="Delete ${item.title}" title="Delete item">×</button></div></div>
    </article>`).join('');
  emptyState.hidden = items.length > 0;
}

function setType(type) {
  activeType = type;
  document.querySelectorAll('.tab').forEach((tab) => {
    const selected = tab.dataset.type === type;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', selected);
  });
  render();
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setType(tab.dataset.type)));
searchInput.addEventListener('input', render);
async function saveCollectionToCode() {
  if (!window.showOpenFilePicker) {
    window.alert('This browser cannot write directly to collection-data.js. Use Chrome or Edge.');
    return;
  }
  try {
    if (!sourceFileHandle) {
      [sourceFileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JavaScript data file', accept: { 'text/javascript': ['.js'] } }]
      });
    }
    const writable = await sourceFileHandle.createWritable();
    await writable.write(`window.collectionData = ${JSON.stringify(collection, null, 2)};\n`);
    await writable.close();
  } catch (error) {
    if (error.name !== 'AbortError') window.alert('The entry was saved in the browser but not in the source code.');
  }
}

async function deleteCollectionItem(item, type) {
  try {
    if (supabaseClient && item.id) {
      const { data, error } = await supabaseClient
        .from('collection_items')
        .delete()
        .eq('id', item.id)
        .select('id');
      if (error) throw error;
      if (!data.length) throw new Error('No database row was deleted. Run the delete policy in Supabase SQL Editor.');
    }
    collection[type].splice(collection[type].indexOf(item), 1);
    localStorage.setItem(storageKey, JSON.stringify(collection));
    render();
  } catch (error) {
    console.error('Could not delete the collection item.', error);
    window.alert(`Could not delete the collection item: ${error?.message || 'Unknown error'}`);
  }
}

function openAddDialog() {
  if (!requireEditorAccess()) return;
  editingIndex = null;
  editingType = null;
  document.querySelector('#addForm').reset();
  document.querySelector('#dialogEyebrow').textContent = 'New arrival';
  document.querySelector('#dialogTitle').textContent = 'Add to the archive';
  document.querySelector('#submitItem').innerHTML = 'Add object <span>↗</span>';
  configureForm(form.elements.medium.value);
  document.querySelector('#addDialog').showModal();
}

document.querySelector('#addItemTop').addEventListener('click', openAddDialog);
document.querySelector('#dialogClose').addEventListener('click', () => document.querySelector('#addDialog').close());
form.elements.medium.addEventListener('change', (event) => configureForm(event.target.value));
grid.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('.delete-button');
  if (deleteButton) {
    if (!requireEditorAccess()) return;
    const item = collection[activeType][Number(deleteButton.dataset.index)];
    if (window.confirm(`Delete "${item.title}" from the collection?`)) deleteCollectionItem(item, activeType);
    return;
  }
  const editButton = event.target.closest('.edit-button');
  if (!editButton) return;
  if (!requireEditorAccess()) return;
  const item = collection[activeType][Number(editButton.dataset.index)];
  editingIndex = Number(editButton.dataset.index);
  editingType = activeType;
  form.elements.title.value = item.title;
  form.elements.creator.value = item.creator;
  form.elements.year.value = item.year === '—' ? '' : item.year;
  form.elements.color.value = item.color || '';
  form.elements.edition.value = item.edition || '';
  form.elements.bookEdition.value = item.edition || '';
  form.elements.format.value = item.format || '';
  form.elements.image.value = item.image;
  form.elements.medium.value = activeType;
  configureForm(activeType);
  document.querySelector('#dialogEyebrow').textContent = 'Edit entry';
  document.querySelector('#dialogTitle').textContent = 'Update the archive';
  document.querySelector('#submitItem').innerHTML = 'Save changes <span>↗</span>';
  document.querySelector('#addDialog').showModal();
});
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); } });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const type = form.get('medium');
  const previousItem = editingIndex === null ? null : collection[editingType][editingIndex];
  const updatedItem = {
    ...(previousItem?.id ? { id: previousItem.id } : {}),
    title: form.get('title'), creator: form.get('creator'), year: form.get('year') || '—',
    image: form.get('image'), color: form.get('color') || '',
    edition: type === 'books' ? form.get('bookEdition') || '' : form.get('edition') || '', format: form.get('format') || ''
  };
  if (editingIndex === null) {
    collection[type].push(updatedItem);
  } else if (editingType === type) {
    collection[type][editingIndex] = updatedItem;
  } else {
    collection[editingType].splice(editingIndex, 1);
    collection[type].push(updatedItem);
  }
  if (!(await saveCollection(updatedItem, type))) return;
  event.currentTarget.reset();
  document.querySelector('#addDialog').close();
  editingIndex = null;
  editingType = null;
  setType(type);
});

loadRemoteCollection()
  .then(render)
  .catch((error) => {
    console.error('Could not load the shared collection.', error);
    window.alert('The shared collection could not be loaded. Showing local data instead.');
    render();
  });
