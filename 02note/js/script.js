/**
 * 02note 核心交互逻辑 (行内编辑+错误诊断版)
 */
document.addEventListener('DOMContentLoaded', function() {
    const contentArea = document.getElementById('content');
    const saveBtn = document.getElementById('saveButton');
    const notesList = document.getElementById('notesList');

    // 1. 加载笔记列表
    async function loadNotes() {
        try {
            const response = await fetch('/api/notes');
            if (!response.ok) throw new Error('读取数据失败');
            
            const data = await response.json();
            notesList.innerHTML = '';
            
            if (!data || data.length === 0) {
                notesList.innerHTML = '<p style="color:#a0aec0;text-align:center;padding:40px;">暂无笔记 ✨</p>';
                return;
            }

            data.forEach((note, index) => {
                const noteDiv = document.createElement('div');
                noteDiv.className = 'note' + (note.is_pinned ? ' pinned' : '');
                
                const numberSpan = document.createElement('span');
                numberSpan.className = 'note-number';
                numberSpan.textContent = note.is_pinned ? '📌 PINNED' : `#${data.length - index}`;
                
                const contentDiv = document.createElement('div');
                contentDiv.className = 'note-content';
                contentDiv.textContent = note.content;
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'actions';

                // 置顶切换 (无需密码)
                const pinLabel = document.createElement('label');
                pinLabel.className = 'pin-toggle-label';
                const pinInput = document.createElement('input');
                pinInput.type = 'checkbox';
                pinInput.checked = !!note.is_pinned;
                pinInput.onchange = () => handleQuickUpdate(note.id, note.content, pinInput.checked);
                pinLabel.appendChild(pinInput);
                pinLabel.append(' 置顶');

                // 修改按钮
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-small edit-btn';
                editBtn.textContent = '修改';
                editBtn.onclick = () => enterEditMode(note, noteDiv, contentDiv, actionsDiv);

                // 删除按钮
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-small delete-btn';
                delBtn.textContent = '删除';
                delBtn.onclick = () => handleDelete(note.id);
                
                actionsDiv.appendChild(pinLabel);
                actionsDiv.appendChild(editBtn);
                actionsDiv.appendChild(delBtn);
                
                noteDiv.appendChild(numberSpan);
                noteDiv.appendChild(contentDiv);
                noteDiv.appendChild(actionsDiv);
                notesList.appendChild(noteDiv);
            });
        } catch (error) {
            notesList.innerHTML = '<p style="color:red;text-align:center;">数据库连接失败</p>';
        }
    }

    // 2. 行内编辑模式
    function enterEditMode(note, noteDiv, contentDiv, actionsDiv) {
        const originalContent = note.content;
        
        // 创建编辑框
        const editArea = document.createElement('textarea');
        editArea.className = 'inline-edit-area';
        editArea.value = originalContent;
        
        // 隐藏原内容，插入编辑框
        contentDiv.style.display = 'none';
        noteDiv.insertBefore(editArea, actionsDiv);
        
        // 自动聚焦
        editArea.focus();
        editArea.style.height = (editArea.scrollHeight) + 'px';

        // 切换按钮
        const originalActionsHTML = actionsDiv.innerHTML;
        actionsDiv.innerHTML = '';

        const saveEditBtn = document.createElement('button');
        saveEditBtn.className = 'btn-small save-edit-btn';
        saveEditBtn.textContent = '保存修改';
        
        const cancelEditBtn = document.createElement('button');
        cancelEditBtn.className = 'btn-small cancel-edit-btn';
        cancelEditBtn.textContent = '取消';

        saveEditBtn.onclick = async () => {
            const newText = editArea.value.trim();
            if (!newText) return;
            
            saveEditBtn.disabled = true;
            saveEditBtn.textContent = '保存中...';

            try {
                const response = await fetch('/api/notes', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        id: note.id, 
                        content: newText,
                        is_pinned: note.is_pinned 
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    await loadNotes();
                } else {
                    alert('保存失败：' + (result.error || '未知原因'));
                    saveEditBtn.disabled = false;
                    saveEditBtn.textContent = '保存修改';
                }
            } catch (err) {
                alert('网络异常，请检查接口配置');
                saveEditBtn.disabled = false;
                saveEditBtn.textContent = '保存修改';
            }
        };

        cancelEditBtn.onclick = () => loadNotes();

        actionsDiv.appendChild(saveEditBtn);
        actionsDiv.appendChild(cancelEditBtn);
    }

    // 3. 快速置顶更新
    async function handleQuickUpdate(id, content, isPinned) {
        try {
            await fetch('/api/notes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, content, is_pinned: isPinned ? 1 : 0 })
            });
            await loadNotes();
        } catch (error) {
            await loadNotes();
        }
    }

    // 4. 删除逻辑 (需密码)
    async function handleDelete(id) {
        const password = prompt('确认删除？请输入管理员密码:');
        if (password === null) return;

        try {
            const response = await fetch('/api/notes', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, password })
            });

            if (response.ok) {
                await loadNotes();
            } else {
                const result = await response.json();
                alert('失败: ' + (result.error || '密码错误'));
            }
        } catch (error) {
            alert('请求异常');
        }
    }

    // 5. 发布逻辑
    saveBtn.addEventListener('click', async function() {
        const content = contentArea.value.trim();
        if (!content) return;
        saveBtn.disabled = true;
        try {
            const response = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, is_pinned: 0 })
            });
            if (response.ok) {
                contentArea.value = '';
                await loadNotes();
            }
        } finally {
            saveBtn.disabled = false;
        }
    });

    loadNotes();
});
