
        const metadataListEl = document.getElementById('metadata-list');
        const generateSummaryBtnEl = document.getElementById('generate-summary-btn');
        const generateKgBtnEl = document.getElementById('generate-kg-btn');
        const summaryInputEl = document.getElementById('summary-input');
        const tagsInputEl = document.getElementById('tags-input');
        const referencedQueriesListEl = document.getElementById('referenced-queries-list');
        const relatedPagesListEl = document.getElementById('related-pages-list');
        const typeInputEl = document.getElementById('type-input');
        const knowledgeGraphInputEl = document.getElementById('knowledge-graph-input');
        const metadataPaneEl = document.querySelector('.metadata-pane');
        
        let selectedMetadata = null;
        let isSummaryGenerating = false;
        let isKgGenerating = false;

        function toMetadataItems(metadata) {
            if (!metadata || typeof metadata !== 'object') {
                return [];
            }
            return Object.entries(metadata)
                .filter(([key]) => key !== 'summary' && key !== 'keywords' && key !== 'tags' && key !== 'referencedQueries' && key !== 'type' && key !== 'knowledgeGraph' && key !== 'relatedPages')
                .map(([key, value]) => {
                    if (Array.isArray(value)) return { key, value: value.join(', ') };
                    if (value && typeof value === 'object') return { key, value: JSON.stringify(value) };
                    return { key, value: String(value ?? '') };
                });
        }

        function setAllFieldsReadOnly() {
            const anyGenerating = isSummaryGenerating || isKgGenerating;
            if (summaryInputEl) summaryInputEl.setAttribute('readonly', '');
            if (tagsInputEl) tagsInputEl.setAttribute('readonly', '');
            if (typeInputEl) typeInputEl.disabled = !selectedDocId || anyGenerating;
            document.querySelectorAll('.field-cancel-btn, .field-save-btn').forEach(btn => { btn.style.display = 'none'; });
            const addQueryBtn = document.getElementById('add-query-btn');
            if (addQueryBtn) addQueryBtn.style.display = 'none';
        }

        function setSummaryGeneratingState(isGenerating) {
            isSummaryGenerating = Boolean(isGenerating);
            const anyGenerating = isSummaryGenerating || isKgGenerating;
            if (metadataPaneEl) metadataPaneEl.classList.toggle('is-busy', anyGenerating);
            const hasDoc = Boolean(selectedDocId);
            if (generateSummaryBtnEl) {
                generateSummaryBtnEl.disabled = !hasDoc || isSummaryGenerating;
                generateSummaryBtnEl.classList.toggle('is-loading', isSummaryGenerating);
            }
            if (anyGenerating) setAllFieldsReadOnly();
        }

        function setKgGeneratingState(isGenerating) {
            isKgGenerating = Boolean(isGenerating);
            const anyGenerating = isSummaryGenerating || isKgGenerating;
            if (metadataPaneEl) metadataPaneEl.classList.toggle('is-busy', anyGenerating);
            const hasDoc = Boolean(selectedDocId);
            if (generateKgBtnEl) {
                generateKgBtnEl.disabled = !hasDoc || isKgGenerating;
                generateKgBtnEl.classList.toggle('is-loading', isKgGenerating);
            }
            if (anyGenerating) setAllFieldsReadOnly();
        }

        function renderMetadata(metadata) {
            selectedMetadata = metadata && typeof metadata === 'object' ? metadata : null;
            const items = toMetadataItems(selectedMetadata);
            const canEdit = Boolean(selectedDocId);
            if (generateSummaryBtnEl) generateSummaryBtnEl.disabled = !canEdit || isSummaryGenerating;
            if (generateKgBtnEl) generateKgBtnEl.disabled = !canEdit || isKgGenerating;
            setAllFieldsReadOnly();

            if(summaryInputEl) summaryInputEl.value = selectedMetadata ? String(selectedMetadata.summary || '') : '';
            if (typeof typeInputEl !== 'undefined' && typeInputEl) typeInputEl.value = selectedMetadata ? String(selectedMetadata.type || 'custom') : 'custom';
            const tagValues = selectedMetadata && Array.isArray(selectedMetadata.tags) ? selectedMetadata.tags : [];
            if(tagsInputEl) tagsInputEl.value = tagValues.join(', ');
            
            // Render knowledge graph mermaid diagram (read-only)
            if (knowledgeGraphInputEl) {
                knowledgeGraphInputEl.value = selectedMetadata ? String(selectedMetadata.knowledgeGraph || '') : '';
            }
            
            // Render referenced queries as a read-only list
            if(referencedQueriesListEl) {
                if (selectedMetadata && selectedMetadata.referencedQueries) {
                    const queries = Array.isArray(selectedMetadata.referencedQueries) ? selectedMetadata.referencedQueries : 
                        String(selectedMetadata.referencedQueries).split(',').map(q => q.trim()).filter(q => q.length > 0);
                    
                    if (queries.length > 0) {
                        referencedQueriesListEl.innerHTML = queries.map(query => `
                            <li class="referenced-query-item"><span class="query-text">${escapeHtml(query)}</span></li>
                        `).join('');
                    } else {
                        referencedQueriesListEl.innerHTML = '<li class="referenced-query-empty">No referenced queries</li>';
                    }
                } else {
                    referencedQueriesListEl.innerHTML = '<li class="referenced-query-empty">No referenced queries</li>';
                }
            }

            // Render related pages as a read-only list
            if (relatedPagesListEl) {
                const related = selectedMetadata && Array.isArray(selectedMetadata.relatedPages)
                    ? selectedMetadata.relatedPages.filter(p => p)
                    : [];
                if (related.length > 0) {
                    relatedPagesListEl.innerHTML = related.map(page => `
                        <li class="referenced-query-item">${escapeHtml(page)}</li>
                    `).join('');
                } else {
                    relatedPagesListEl.innerHTML = '<li class="referenced-query-empty">No related pages</li>';
                }
            }

            if (metadataListEl) {
                if (items.length === 0) {
                    metadataListEl.innerHTML = '<li class="metadata-item">title: -</li>';
                } else {
                    metadataListEl.innerHTML = items.map(item => `
                        <li class="metadata-item">${escapeHtml(item.key)}: ${escapeHtml(item.value)}</li>
                    `).join('');
                }
            }
        }
        
        if (generateSummaryBtnEl) {
            generateSummaryBtnEl.addEventListener('click', () => {
                if (!selectedDocId || isSummaryGenerating) return;
                setSummaryGeneratingState(true);
                vscode.postMessage({ command: 'generateSummaryForDoc', docId: selectedDocId });
            });
        }

        if (generateKgBtnEl) {
            generateKgBtnEl.addEventListener('click', () => {
                if (!selectedDocId || isKgGenerating) return;
                setKgGeneratingState(true);
                vscode.postMessage({ command: 'generateKgForDoc', docId: selectedDocId });
            });
        }

        function enterFieldEdit(fieldId) {
            if (!selectedDocId || isSummaryGenerating || isKgGenerating) return;
            const group = document.getElementById('field-group-' + fieldId);
            if (!group) return;
            const cancelBtn = group.querySelector('.field-cancel-btn');
            const saveBtn = group.querySelector('.field-save-btn');
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
            if (saveBtn) saveBtn.style.display = 'inline-block';
            if (fieldId === 'summary' || fieldId === 'tags') {
                const ta = group.querySelector('textarea');
                if (ta) { ta.removeAttribute('readonly'); ta.focus(); }
            }
        }

        function exitFieldEdit(fieldId, revert) {
            const group = document.getElementById('field-group-' + fieldId);
            if (!group) return;
            const cancelBtn = group.querySelector('.field-cancel-btn');
            const saveBtn = group.querySelector('.field-save-btn');
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
            if (revert && selectedMetadata) {
                if (fieldId === 'summary' && summaryInputEl) summaryInputEl.value = String(selectedMetadata.summary || '');
                if (fieldId === 'tags' && tagsInputEl) tagsInputEl.value = Array.isArray(selectedMetadata.tags) ? selectedMetadata.tags.join(', ') : '';
                if (fieldId === 'type' && typeInputEl) typeInputEl.value = String(selectedMetadata.type || 'custom');
            }
            if (fieldId === 'summary' || fieldId === 'tags') {
                const ta = group.querySelector('textarea');
                if (ta) ta.setAttribute('readonly', '');
            }
        }

        function saveFieldMetadata() {
            const tags = String(tagsInputEl ? tagsInputEl.value : '')
                .split(',').map(t => t.trim()).filter(t => t.length > 0).join(', ');
            vscode.postMessage({
                command: 'saveMetadata',
                docId: selectedDocId,
                type: typeInputEl ? typeInputEl.value : 'custom',
                summary: summaryInputEl ? summaryInputEl.value : '',
                tags
            });
        }

        // Type: single-click opens dropdown; mousedown shows Save/Cancel
        if (typeInputEl) {
            let typeEditShown = false;
            typeInputEl.addEventListener('mousedown', () => {
                if (!selectedDocId || isSummaryGenerating || isKgGenerating) return;
                if (!typeEditShown) {
                    typeEditShown = true;
                    enterFieldEdit('type');
                }
            });
            const typeGroup = document.getElementById('field-group-type');
            if (typeGroup) {
                typeGroup.querySelector('.field-cancel-btn').addEventListener('click', () => {
                    typeEditShown = false;
                    exitFieldEdit('type', true);
                });
                typeGroup.querySelector('.field-save-btn').addEventListener('click', () => {
                    typeEditShown = false;
                    saveFieldMetadata();
                    exitFieldEdit('type', false);
                });
            }
        }

        // Summary / Tags: dblclick on textarea or label enters edit
        ['summary', 'tags'].forEach(fieldId => {
            const group = document.getElementById('field-group-' + fieldId);
            if (!group) return;
            const ta = group.querySelector('textarea');
            const label = group.querySelector('.metadata-label');
            [ta, label].forEach(el => {
                if (!el) return;
                el.addEventListener('dblclick', () => enterFieldEdit(fieldId));
            });
            group.querySelector('.field-cancel-btn').addEventListener('click', () => exitFieldEdit(fieldId, true));
            group.querySelector('.field-save-btn').addEventListener('click', () => {
                saveFieldMetadata();
                exitFieldEdit(fieldId, false);
            });
        });

        // Referenced Queries: dblclick enters edit mode
        (function () {
            const addQueryBtnEl = document.getElementById('add-query-btn');
            const refGroup = document.getElementById('field-group-refqueries');
            if (!refGroup) return;

            function enterRefEdit() {
                if (!selectedDocId || isSummaryGenerating || isKgGenerating) return;
                refGroup.querySelector('.field-cancel-btn').style.display = 'inline-block';
                refGroup.querySelector('.field-save-btn').style.display = 'inline-block';
                if (addQueryBtnEl) addQueryBtnEl.style.display = 'inline-block';
                // add × and span-wrap existing items
                referencedQueriesListEl.querySelectorAll('.referenced-query-item').forEach(li => {
                    if (li.querySelector('.query-delete-btn')) return;
                    const span = li.querySelector('.query-text') || li;
                    const delBtn = document.createElement('button');
                    delBtn.className = 'query-delete-btn action-btn action-btn-sm';
                    delBtn.textContent = '×';
                    delBtn.type = 'button';
                    delBtn.addEventListener('click', () => li.remove());
                    li.appendChild(delBtn);
                });
                const empty = referencedQueriesListEl.querySelector('.referenced-query-empty');
                if (empty) empty.remove();
            }

            function exitRefEdit(revert) {
                refGroup.querySelector('.field-cancel-btn').style.display = 'none';
                refGroup.querySelector('.field-save-btn').style.display = 'none';
                if (addQueryBtnEl) addQueryBtnEl.style.display = 'none';
                if (revert) {
                    // re-render original
                    const queries = selectedMetadata && selectedMetadata.referencedQueries
                        ? (Array.isArray(selectedMetadata.referencedQueries) ? selectedMetadata.referencedQueries
                            : String(selectedMetadata.referencedQueries).split(',').map(q => q.trim()).filter(q => q))
                        : [];
                    if (queries.length > 0) {
                        referencedQueriesListEl.innerHTML = queries.map(q => `<li class="referenced-query-item"><span class="query-text">${escapeHtml(q)}</span></li>`).join('');
                    } else {
                        referencedQueriesListEl.innerHTML = '<li class="referenced-query-empty">No referenced queries</li>';
                    }
                }
            }

            [referencedQueriesListEl, refGroup.querySelector('.metadata-label')].forEach(el => {
                if (!el) return;
                el.addEventListener('dblclick', enterRefEdit);
            });

            if (addQueryBtnEl) {
                addQueryBtnEl.addEventListener('click', () => {
                    const li = document.createElement('li');
                    li.className = 'referenced-query-item query-new-item';
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'query-new-input metadata-input';
                    input.placeholder = 'New query...';
                    const delBtn = document.createElement('button');
                    delBtn.className = 'query-delete-btn action-btn action-btn-sm';
                    delBtn.textContent = '×';
                    delBtn.type = 'button';
                    delBtn.addEventListener('click', () => li.remove());
                    li.appendChild(input);
                    li.appendChild(delBtn);
                    referencedQueriesListEl.appendChild(li);
                    input.focus();
                });
            }

            refGroup.querySelector('.field-cancel-btn').addEventListener('click', () => exitRefEdit(true));
            refGroup.querySelector('.field-save-btn').addEventListener('click', () => {
                const queries = Array.from(referencedQueriesListEl.querySelectorAll('li:not(.referenced-query-empty)'))
                    .map(li => {
                        const input = li.querySelector('input[type="text"]');
                        if (input) return input.value.trim();
                        const span = li.querySelector('.query-text');
                        return span ? span.textContent.trim() : '';
                    })
                    .filter(q => q.length > 0);
                const tags = String(tagsInputEl ? tagsInputEl.value : '')
                    .split(',').map(t => t.trim()).filter(t => t.length > 0).join(', ');
                vscode.postMessage({
                    command: 'saveMetadata',
                    docId: selectedDocId,
                    type: typeInputEl ? typeInputEl.value : 'custom',
                    summary: summaryInputEl ? summaryInputEl.value : '',
                    tags,
                    referencedQueries: queries
                });
                exitRefEdit(false);
            });
        })();

        document.querySelectorAll('.metadata-section-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = btn.closest('.metadata-field-group');
                if (!group) {
                    // top-level collapse-all button
                    const allGroups = document.querySelectorAll('.metadata-field-group');
                    const anyExpanded = Array.from(allGroups).some(g => !g.classList.contains('contracted'));
                    allGroups.forEach(g => {
                        const sectionBtn = g.querySelector('.metadata-section-btn');
                        if (anyExpanded) {
                            g.classList.add('contracted');
                            if (sectionBtn) { sectionBtn.textContent = '\u25B6'; sectionBtn.title = 'Expand'; }
                        } else {
                            g.classList.remove('contracted');
                            if (sectionBtn) { sectionBtn.textContent = '\u25BC'; sectionBtn.title = 'Collapse'; }
                        }
                    });
                    btn.textContent = anyExpanded ? '\u25B6' : '\u25BC';
                    btn.title = anyExpanded ? 'Expand all' : 'Collapse all';
                    return;
                }
                const isContracted = group.classList.toggle('contracted');
                btn.textContent = isContracted ? '\u25B6' : '\u25BC';
                btn.title = isContracted ? 'Expand' : 'Collapse';
            });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message?.command === 'metadataUpdated') {
                const payload = message.payload || {};
                const updatedDocId = String(payload.id || '').trim();
                const metadata = payload.metadata || null;
                if (updatedDocId && String(selectedDocId) === updatedDocId) {
                    renderMetadata(metadata);
                }
            }
            if (message?.command === 'summaryGenerationState') {
                const payload = message.payload || {};
                const messageDocId = String(payload.docId || '').trim();
                if (messageDocId && String(selectedDocId) === messageDocId) {
                    setSummaryGeneratingState(Boolean(payload.isGenerating));
                }
            }
            if (message?.command === 'kgGenerationState') {
                const payload = message.payload || {};
                const messageDocId = String(payload.docId || '').trim();
                if (messageDocId && String(selectedDocId) === messageDocId) {
                    setKgGeneratingState(Boolean(payload.isGenerating));
                }
            }
        });
