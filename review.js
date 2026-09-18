/* review.js — 오늘 회고의 질문과 규칙. review-agent 의 네 질문 그대로. */
(function (root) {
  const QUESTIONS = [
    { id: 'good', q: '오늘 잘된 것은?' },
    { id: 'bad', q: '안 된 것은?' },
    { id: 'learned', q: '배운 것은?' },
    { id: 'tomorrow', q: '내일 첫 번째로 할 것은?' },
  ];
  const isEditable = (date, today) => date === today;
  const isComplete = rec => !!rec && QUESTIONS.every(x => typeof rec[x.id] === 'string' && rec[x.id].trim() !== '');
  const shouldNudge = (rec, hhmm) => hhmm >= '21:00' && !isComplete(rec);

  const LifeReview = { QUESTIONS, isEditable, isComplete, shouldNudge };
  if (typeof module !== 'undefined' && module.exports) module.exports = LifeReview;
  else root.LifeReview = LifeReview;
})(typeof globalThis !== 'undefined' ? globalThis : this);
