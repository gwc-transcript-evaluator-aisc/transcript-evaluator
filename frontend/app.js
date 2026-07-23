(() => {
  const config = window.COURSE_CATALOG_CONFIG || {};
  const queryApi = new URLSearchParams(window.location.search).get('api');
  const apiBaseUrl = (queryApi || config.apiBaseUrl || '').replace(/\/$/, '');
  const maxBytes = 50 * 1024 * 1024;

  const tabs = document.querySelector('#tabs');
  const viewUpload = document.querySelector('#view-upload');
  const viewLookup = document.querySelector('#view-lookup');
  const viewBrowse = document.querySelector('#view-browse');

  const errorBox = document.querySelector('#error');
  function setError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }
  async function request(path, options = {}) {
    if (!apiBaseUrl) throw new Error('Set apiBaseUrl in frontend/config.js or add ?api=https://your-api-url to the page URL.');
    const response = await fetch(`${apiBaseUrl}${path}`, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202 && response.status !== 404) {
      throw new Error(body.error || body.errorMessage || `Request failed (${response.status})`);
    }
    return { ok: response.ok, status: response.status, body };
  }

  // ---- Tabs ----
  function showView(view) {
    viewUpload.hidden = view !== 'upload';
    viewLookup.hidden = view !== 'lookup';
    viewBrowse.hidden = view !== 'browse';
    for (const button of tabs.querySelectorAll('.tab-button')) button.classList.toggle('active', button.dataset.view === view);
    setError('');
    if (view === 'browse') loadCatalogs();
  }
  tabs.addEventListener('click', (event) => { const button = event.target.closest('.tab-button'); if (button) showView(button.dataset.view); });

  // ---- Exact course lookup ----
  const lookupForm = document.querySelector('#lookup-form');
  const lookupInstitution = document.querySelector('#lookup-institution');
  const lookupYear = document.querySelector('#lookup-year');
  const lookupCourseInput = document.querySelector('#lookup-course');
  const lookupResult = document.querySelector('#lookup-result');

  function renderCourseDetail(course) {
    const rows = [
      ['Title', course.courseTitle],
      ['Department', course.department],
      ['Credits', course.credits],
      ['Level', course.courseLevel],
      ['Delivery', course.deliveryMode],
      ['Duration', course.duration],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
    const details = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    const description = course.description ? `<p>${escapeHtml(course.description)}</p>` : '<p class="hint">No description was extracted for this course.</p>';
    lookupResult.innerHTML = `<h3>${escapeHtml(course.courseCode)}</h3>${description}${details ? `<dl class="detail-grid">${details}</dl>` : ''}`;
  }

  lookupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    const institution = lookupInstitution.value.trim();
    const academicYear = lookupYear.value.trim();
    const courseCode = lookupCourseInput.value.trim();
    if (!institution || !academicYear || !courseCode) return setError('School, catalog year, and course code are required.');
    lookupResult.innerHTML = '<p class="hint">Looking up\u2026</p>';
    try {
      const { status, body } = await request(`/catalogs/${encodeURIComponent(institution)}/${encodeURIComponent(academicYear)}/courses/${encodeURIComponent(courseCode)}`);
      if (status === 404) {
        lookupResult.innerHTML = `<p class="hint">No course matching "${escapeHtml(courseCode)}" was found in ${escapeHtml(institution)}'s ${escapeHtml(academicYear)} catalog.</p>`;
        return;
      }
      renderCourseDetail(body.course);
    } catch (error) {
      lookupResult.innerHTML = '';
      setError(error.message);
    }
  });

  // ---- Upload flow ----
  const uploadInstitution = document.querySelector('#upload-institution');
  const uploadYear = document.querySelector('#upload-year');
  const fileInput = document.querySelector('#catalog-file');
  const dropzone = document.querySelector('#dropzone');
  const fileRow = document.querySelector('#file-row');
  const fileName = document.querySelector('#file-name');
  const startButton = document.querySelector('#start-button');
  const statusPanel = document.querySelector('#status-panel');
  const statusTitle = document.querySelector('#status-title');
  const statusDetail = document.querySelector('#status-detail');
  const progressBar = document.querySelector('#progress-bar');
  const statusDot = document.querySelector('#status-dot');

  let selectedFile = null;
  let pollTimer = null;

  function setStatus(title, detail, progress, failed = false) { statusPanel.hidden = false; statusTitle.textContent = title; statusDetail.textContent = detail; progressBar.style.width = `${progress}%`; statusDot.classList.toggle('failed', failed); }

  function selectFile(file) {
    setError('');
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return setError('Please choose a PDF file.');
    if (file.size > maxBytes) return setError('That file is larger than the 50 MB prototype limit.');
    selectedFile = file;
    fileName.textContent = `${file.name} \u00b7 ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    fileRow.hidden = false;
    startButton.disabled = false;
  }
  function resetUpload() {
    selectedFile = null; fileInput.value = ''; fileRow.hidden = true; startButton.disabled = true; statusPanel.hidden = true; setError('');
    if (pollTimer) clearTimeout(pollTimer);
  }
  async function startUpload() {
    if (!selectedFile) return;
    const institution = uploadInstitution.value.trim();
    const academicYear = uploadYear.value.trim();
    if (!institution || !academicYear) return setError('School and catalog year are required.');
    startButton.disabled = true; setError(''); setStatus('Creating upload job', 'Preparing a secure upload URL\u2026', 5);
    try {
      const { body: job } = await request('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ institution, academicYear }) });
      setStatus('Uploading PDF', selectedFile.name, 15);
      const upload = await fetch(job.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: selectedFile });
      if (!upload.ok) throw new Error('The PDF upload failed. Please try again.');
      setStatus('Splitting into pages', 'Each page is processed as its own extraction job\u2026', 25);
      await request(`/jobs/${job.jobId}/complete`, { method: 'POST' });
      pollJob(job.jobId);
    } catch (error) {
      startButton.disabled = false; setStatus('Upload failed', error.message, 0, true); setError(error.message);
    }
  }
  async function pollJob(jobId) {
    try {
      const { body: job } = await request(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') {
        setStatus('Extraction complete', job.catalogId ? `Saved ${job.courseCount ?? 0} course(s) to the database.` : 'No courses were found in this document.', 100);
        if (job.errorMessage) setError(job.errorMessage);
        return;
      }
      if (job.status === 'FAILED') throw new Error(job.errorMessage || 'The catalog could not be processed.');
      const total = job.totalPages || 0;
      const completed = job.pagesCompleted || 0;
      const progress = total > 0 ? 25 + Math.round((completed / total) * 70) : 30;
      setStatus('Extracting course data', total > 0 ? `Processed ${completed} of ${total} page(s)\u2026` : 'Bedrock Data Automation is processing the catalog\u2026', progress);
      pollTimer = setTimeout(() => pollJob(jobId), 4000);
    } catch (error) {
      setStatus('Processing failed', error.message, 0, true); setError(error.message); startButton.disabled = false;
    }
  }
  fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
  dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); selectFile(event.dataTransfer.files[0]); });
  document.querySelector('#clear-file').addEventListener('click', resetUpload);
  startButton.addEventListener('click', startUpload);

  // ---- Database browser ----
  const catalogListView = document.querySelector('#catalog-list-view');
  const courseListView = document.querySelector('#course-list-view');
  const catalogRows = document.querySelector('#catalog-rows');
  const catalogEmpty = document.querySelector('#catalog-empty');
  const courseRows = document.querySelector('#course-rows');
  const browseHeading = document.querySelector('#browse-heading');
  const refreshButton = document.querySelector('#refresh-catalogs');
  const backButton = document.querySelector('#back-to-catalogs');

  async function loadCatalogs() {
    setError('');
    courseListView.hidden = true; catalogListView.hidden = false; browseHeading.textContent = 'Catalogs';
    catalogRows.innerHTML = '<tr><td colspan="5">Loading\u2026</td></tr>';
    try {
      const { body } = await request('/db/catalogs');
      const catalogs = body.catalogs || [];
      catalogRows.innerHTML = '';
      catalogEmpty.hidden = catalogs.length > 0;
      for (const cat of catalogs) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.innerHTML = `<td>${escapeHtml(cat.institution)}</td><td>${escapeHtml(cat.academicYear)}</td><td>${escapeHtml(cat.status)}</td><td>${escapeHtml(cat.courseCount ?? '\u2014')}</td><td>${escapeHtml(new Date(cat.updatedAt).toLocaleString())}</td>`;
        row.addEventListener('click', () => loadCourses(cat));
        catalogRows.appendChild(row);
      }
    } catch (error) {
      catalogRows.innerHTML = '';
      setError(error.message);
    }
  }
  async function loadCourses(cat) {
    setError('');
    catalogListView.hidden = true; courseListView.hidden = false;
    browseHeading.textContent = `${cat.institution} \u00b7 ${cat.academicYear}`;
    courseRows.innerHTML = '<tr><td colspan="5">Loading\u2026</td></tr>';
    try {
      const { body } = await request(`/db/catalogs/${encodeURIComponent(cat.catalogId)}/courses`);
      const courses = body.courses || [];
      courseRows.innerHTML = '';
      for (const course of courses) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${escapeHtml(course.courseCode)}</td><td>${escapeHtml(course.courseTitle || '\u2014')}</td><td>${escapeHtml(course.department || '\u2014')}</td><td>${escapeHtml(course.credits ?? '\u2014')}</td><td>${escapeHtml(course.description || '\u2014')}</td>`;
        courseRows.appendChild(row);
      }
    } catch (error) {
      courseRows.innerHTML = '';
      setError(error.message);
    }
  }
  refreshButton.addEventListener('click', loadCatalogs);
  backButton.addEventListener('click', loadCatalogs);

  showView('browse');
})();
