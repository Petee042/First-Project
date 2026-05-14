'use strict';

function setStatus(text, isError) {
  const status = document.getElementById('statusMessage');
  if (!status) {
    return;
  }
  status.textContent = text || '';
  status.className = text ? 'status ' + (isError ? 'error' : 'success') : 'status';
}

const form = document.getElementById('emailForm');
const sendButton = document.getElementById('sendButton');

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const recipient = document.getElementById('recipient').value.trim();
    const subject = document.getElementById('subject').value.trim();
    const message = document.getElementById('message').value.trim();

    if (!recipient) {
      setStatus('Enter an email address.', true);
      return;
    }

    setStatus('Sending email...', false);
    if (sendButton) {
      sendButton.disabled = true;
    }

    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recipient, subject, message })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to send email.');
      }

      setStatus('Email sent to ' + recipient + '.', false);
    } catch (error) {
      setStatus(error.message || 'Unable to send email.', true);
    } finally {
      if (sendButton) {
        sendButton.disabled = false;
      }
    }
  });
}
