const GAP = 8;
const MAX_CARD_WIDTH = 200;
const MIN_CARD_WIDTH = 140;
const MODAL_TOP_OFFSET = 72;

const state = {
    albums: [],
    albumCards: [],
    modalCards: [],
    activeAlbum: null
};

async function init() {
    const app = document.getElementById('app');
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modal-content');
    const modalClose = document.getElementById('modal-close');

    if (!app || !modal || !modalContent || !modalClose) {
        return;
    }

    bindGlobalEvents(app, modal, modalContent, modalClose);

    try {
        state.albums = await loadData();
        renderAlbumGrid(app);
    } catch (error) {
        renderAppMessage(
            app,
            '图片数据加载失败',
            window.location.protocol === 'file:'
                ? '请使用本地 HTTP 服务启动当前目录，例如运行 python3 -m http.server 8000。'
                : '请稍后重试，或检查 vipPicture.json 是否可访问。'
        );
        console.error(error);
    }
}

function bindGlobalEvents(app, modal, modalContent, modalClose) {
    const debouncedResize = debounce(() => {
        layoutCards(app, state.albumCards, getAlbumHeight);

        if (state.activeAlbum) {
            layoutCards(modalContent, state.modalCards, getImageHeight, MODAL_TOP_OFFSET);
        }
    }, 160);

    window.addEventListener('resize', debouncedResize);
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeModal(modal, modalContent);
        }
    });

    modalClose.addEventListener('click', () => closeModal(modal, modalContent));
    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeModal(modal, modalContent);
        }
    });
}

function renderAlbumGrid(app) {
    clearContainer(app);

    if (!state.albums.length) {
        renderAppMessage(app, '暂无图片数据', '可以检查 vipPicture.json 是否为空。');
        return;
    }

    state.albumCards = state.albums.map(album => createAlbumCard(album));
    app.append(...state.albumCards);
    layoutCards(app, state.albumCards, getAlbumHeight);
}

function openAlbum(album) {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modal-content');

    if (!modal || !modalContent) {
        return;
    }

    state.activeAlbum = album;
    clearContainer(modalContent);

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = album.title || 'Untitled Album';
    modalContent.appendChild(title);

    state.modalCards = (album.srcs || []).map(image => createImageCard(image));
    modalContent.append(...state.modalCards);

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    layoutCards(modalContent, state.modalCards, getImageHeight, MODAL_TOP_OFFSET);
}

function closeModal(modal, modalContent) {
    if (!state.activeAlbum) {
        return;
    }

    state.activeAlbum = null;
    state.modalCards = [];
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    clearContainer(modalContent);
}

function createAlbumCard(album) {
    const card = buildCardShell();
    card.classList.add('album-card');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', album.title || 'Open album');
    card.dataset.aspectRatio = String(getAspectRatio(getAlbumAspectRatio(album)));

    const img = buildImageNode(getCoverSrc(album), album.title || 'Album cover');
    const overlay = document.createElement('div');
    overlay.className = 'card-overlay';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = album.title || 'Untitled Album';

    overlay.appendChild(title);
    card.appendChild(img);
    card.appendChild(overlay);

    const handleOpen = () => openAlbum(album);
    card.addEventListener('click', handleOpen);
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpen();
        }
    });

    return card;
}

function createImageCard(image) {
    const card = buildCardShell();
    card.classList.add('modal-card');
    card.dataset.aspectRatio = String(getAspectRatio(image.aspect_ratio));
    card.appendChild(buildImageNode(image.src, 'Album image'));
    return card;
}

function buildCardShell() {
    const card = document.createElement('article');
    card.className = 'card';
    return card;
}

function buildImageNode(src, alt) {
    const img = document.createElement('img');
    img.src = src || '';
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    return img;
}

function layoutCards(container, cards, heightGetter, topOffset = GAP) {
    if (!cards.length) {
        container.style.height = topOffset + 'px';
        return;
    }

    const { cols, cardWidth, startX } = getLayoutMetrics(container.clientWidth);
    const columnHeights = new Array(cols).fill(topOffset);

    cards.forEach(card => {
        const height = heightGetter(cardWidth, card);
        const columnIndex = getShortestColumnIndex(columnHeights);

        card.style.width = `${cardWidth}px`;
        card.style.height = `${height}px`;
        card.style.left = `${startX + columnIndex * (cardWidth + GAP)}px`;
        card.style.top = `${columnHeights[columnIndex]}px`;

        columnHeights[columnIndex] += height + GAP;
    });

    container.style.height = `${Math.max(...columnHeights)}px`;
}

function getLayoutMetrics(containerWidth) {
    const availableWidth = Math.max(containerWidth, MIN_CARD_WIDTH + GAP * 2);
    const cols = Math.max(1, Math.floor((availableWidth + GAP) / (MAX_CARD_WIDTH + GAP)));
    const rawWidth = Math.floor((availableWidth - GAP * (cols - 1)) / cols);
    const cardWidth = Math.max(Math.min(rawWidth, MAX_CARD_WIDTH), Math.min(MIN_CARD_WIDTH, availableWidth));
    const contentWidth = cols * cardWidth + GAP * (cols - 1);
    const startX = Math.max(0, Math.floor((availableWidth - contentWidth) / 2));

    return { cols, cardWidth, startX };
}

function getShortestColumnIndex(columnHeights) {
    let targetIndex = 0;

    for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[targetIndex]) {
            targetIndex = index;
        }
    }

    return targetIndex;
}

function getAlbumHeight(cardWidth, card) {
    return getCardHeight(cardWidth, card.dataset.aspectRatio);
}

function getImageHeight(cardWidth, card) {
    return getCardHeight(cardWidth, card.dataset.aspectRatio);
}

function getCardHeight(cardWidth, rawAspectRatio) {
    return Math.max(120, Math.round(cardWidth / getAspectRatio(rawAspectRatio)));
}

function getAspectRatio(value) {
    const aspectRatio = Number(value);
    return aspectRatio > 0 ? aspectRatio : 1;
}

function getCoverSrc(album) {
    return album.srcs && album.srcs[0] ? album.srcs[0].src : '';
}

function getAlbumAspectRatio(album) {
    return album.srcs && album.srcs[0] ? album.srcs[0].aspect_ratio : 1;
}

function clearContainer(container) {
    container.innerHTML = '';
    container.style.height = '';
}

function renderAppMessage(container, title, description) {
    clearContainer(container);

    const box = document.createElement('section');
    box.className = 'app-message';

    const heading = document.createElement('h2');
    heading.textContent = title;

    const text = document.createElement('p');
    text.textContent = description;

    box.appendChild(heading);
    box.appendChild(text);
    container.appendChild(box);
}

async function loadData() {
    const response = await fetch('vipPicture.json');

    if (!response.ok) {
        throw new Error(`Failed to load vipPicture.json: ${response.status}`);
    }

    const data = await response.json();

    return data.map(album => ({
        ...album,
        srcs: Array.isArray(album.srcs) ? album.srcs : []
    }));
}

function debounce(func, wait) {
    let timeoutId;

    return function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };
}

window.addEventListener('DOMContentLoaded', init);
