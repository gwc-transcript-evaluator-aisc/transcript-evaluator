(() => {
  const config = window.DASHBOARD_CONFIG || {};
  const queryApi = new URLSearchParams(window.location.search).get('api');
  const apiBaseUrl = (queryApi || config.apiBaseUrl || '').replace(/\/$/, '');

  const form = document.querySelector('#evaluate-form');
  const submitButton = document.querySelector('#submit-button');
  const errorBox = document.querySelector('#error');
  const resultPanel = document.querySelector('#result-panel');
  const resultTitle = document.querySelector('#result-title');
  const resultBody = document.querySelector('#result-body');

  function setError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }
  function field(id) { return document.querySelector(id).value.trim(); }

  function renderEvaluated(evaluation) {
    resultTitle.textContent = `Decision: ${evaluation.assessment.decision}`;
    const rows = [
      ['Confidence', evaluation.assessment.confidence],
      ['Credit hours comparable', evaluation.assessment.creditHoursComparable ? 'Yes' : 'No'],
      ['Model', evaluation.modelId],
      ['Evaluation ID', evaluation.evaluationId],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    resultBody.innerHTML = `
      <dl class="detail-grid">${rows}</dl>
      <h3>Rationale</h3>
      <p>${escapeHtml(evaluation.assessment.rationale)}</p>
      ${evaluation.assessment.contentCoverageNotes ? `<h3>Content coverage notes</h3><p>${escapeHtml(evaluation.assessment.contentCoverageNotes)}</p>` : ''}
    `;
  }

  function renderNotFound(missing, message) {
    resultTitle.textContent = `Not found: ${missing}`;
    resultBody.innerHTML = `<p>${escapeHtml(message)}</p>`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    resultPanel.hidden = true;
    if (!apiBaseUrl) return setError('Set apiBaseUrl in frontend/config.js or add ?api=https://your-api-url to the page URL.');

    const payload = {
      home: { institution: field('#home-institution'), academicYear: field('#home-year'), courseCode: field('#home-course') },
      transfer: { institution: field('#transfer-institution'), academicYear: field('#transfer-year'), courseCode: field('#transfer-course') },
    };

    submitButton.disabled = true;
    submitButton.textContent = 'Evaluating\u2026';
    try {
      const response = await fetch(`${apiBaseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);

      resultPanel.hidden = false;
      if (body.kind === 'EVALUATED') renderEvaluated(body.evaluation);
      else if (body.kind === 'NOT_FOUND') renderNotFound(body.missing, body.message);
      else resultBody.innerHTML = `<pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>`;
    } catch (error) {
      setError(error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Evaluate';
    }
  });
})();
