// Global variables
let socket = null;
let currentUser = null;
let currentContact = null;
let isTyping = false;
let typingTimer = null;

// Page navigation functions
function showLogin() {
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('registerPage').style.display = 'none';
    document.getElementById('successPage').style.display = 'none';
    document.getElementById('chatPage').style.display = 'none';
}

function showRegister() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('registerPage').style.display = 'flex';
    document.getElementById('successPage').style.display = 'none';
    document.getElementById('chatPage').style.display = 'none';
}

function showChat() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('registerPage').style.display = 'none';
    document.getElementById('successPage').style.display = 'none';
    document.getElementById('chatPage').style.display = 'flex';
}

function showSuccess(username, connectionCode) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('registerPage').style.display = 'none';
    document.getElementById('successPage').style.display = 'flex';
    document.getElementById('chatPage').style.display = 'none';
    
    document.getElementById('successUsername').textContent = username;
    document.getElementById('connectionCodeDisplay').textContent = connectionCode;
}

// Modal functions
function showAddContactModal() {
    document.getElementById('addContactModal').style.display = 'block';
    document.getElementById('contactCodeInput').value = '';
}

function closeAddContactModal() {
    document.getElementById('addContactModal').style.display = 'none';
}

// Form handlers
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    
    try {
        const response = await fetch('/login', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const userData = await response.json();
            currentUser = userData;
            initializeChat();
            showChat();
        } else {
            const error = await response.json();
            showError('loginError', error.error);
        }
    } catch (error) {
        showError('loginError', 'Network error occurred');
    }
});

document.getElementById('registerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    
    try {
        const response = await fetch('/register', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            showSuccess(result.username, result.connection_code);
        } else {
            const error = await response.json();
            showError('registerError', error.error);
        }
    } catch (error) {
        showError('registerError', 'Network error occurred');
    }
});

// Chat functions
async function initializeChat() {
    // Initialize Socket.io connection
    socket = io();
    
    // Set user info
    document.getElementById('currentUsername').textContent = currentUser.username;
    document.getElementById('currentUserCode').textContent = currentUser.connection_code;
    
    // Load contacts
    await loadContacts();
    
    // Setup socket events
    setupSocketEvents();
    
    // Setup message input
    setupMessageInput();
}

async function loadContacts() {
    try {
        const response = await fetch('/contacts');
        const contacts = await response.json();
        
        const contactsList = document.getElementById('contactsList');
        contactsList.innerHTML = '';
        
        contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            contactElement.className = 'contact-item';
            contactElement.innerHTML = `
                <div class="contact-name">${contact.contact_name}</div>
                <div class="contact-code">${contact.contact_code}</div>
            `;
            contactElement.addEventListener('click', () => selectContact(contact));
            contactsList.appendChild(contactElement);
        });
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

function selectContact(contact) {
    currentContact = contact;
    
    // Update UI
    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    document.getElementById('currentContact').textContent = contact.contact_name;
    document.getElementById('messageInput').disabled = false;
    document.getElementById('sendBtn').disabled = false;
    
    // Load messages
    loadMessages(contact.contact_code);
}

async function loadMessages(contactCode) {
    try {
        const response = await fetch(`/get_messages/${contactCode}`);
        const messages = await response.json();
        
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            addMessageToChat(message, false);
        });
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function addMessageToChat(message, isNew = true) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.sender === currentUser.connection_code ? 'sent' : 'received'}`;
    messageElement.innerHTML = `
        <div class="message-content">${message.content}</div>
        <div class="message-time">${message.timestamp}</div>
    `;
    
    if (isNew) {
        messagesContainer.appendChild(messageElement);
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
        messagesContainer.insertBefore(messageElement, messagesContainer.firstChild);
    }
}

async function addContact() {
    const contactCode = document.getElementById('contactCodeInput').value.trim();
    
    if (!contactCode) {
        alert('Please enter a connection code');
        return;
    }
    
    try {
        const response = await fetch('/add_contact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ contact_code: contactCode })
        });
        
        if (response.ok) {
            closeAddContactModal();
            await loadContacts();
        } else {
            const error = await response.json();
            alert(error.error);
        }
    } catch (error) {
        alert('Error adding contact');
    }
}

function setupMessageInput() {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    messageInput.addEventListener('input', function() {
        if (!isTyping && currentContact) {
            isTyping = true;
            socket.emit('typing', {
                receiver: currentContact.contact_code,
                is_typing: true
            });
        }
        
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            isTyping = false;
            if (currentContact) {
                socket.emit('typing', {
                    receiver: currentContact.contact_code,
                    is_typing: false
                });
            }
        }, 1000);
    });
    
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    sendBtn.addEventListener('click', sendMessage);
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const content = messageInput.value.trim();
    
    if (!content || !currentContact) return;
    
    // Send via socket
    socket.emit('send_message', {
        receiver: currentContact.contact_code,
        content: content
    });
    
    // Clear input
    messageInput.value = '';
}

function setupSocketEvents() {
    socket.on('receive_message', function(data) {
        if (currentContact && data.sender === currentContact.contact_code) {
            addMessageToChat(data);
        }
    });
    
    socket.on('user_typing', function(data) {
        const messagesContainer = document.getElementById('messagesContainer');
        let typingIndicator = document.getElementById('typingIndicator');
        
        if (data.is_typing) {
            if (!typingIndicator) {
                typingIndicator = document.createElement('div');
                typingIndicator.id = 'typingIndicator';
                typingIndicator.className = 'typing-indicator';
                typingIndicator.textContent = `${currentContact.contact_name} is typing...`;
                messagesContainer.appendChild(typingIndicator);
            }
        } else {
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
    
    socket.on('user_status', function(data) {
        console.log(`User ${data.user} is ${data.status}`);
    });
}

// Utility functions
function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('addContactModal');
    if (event.target === modal) {
        closeAddContactModal();
    }
});

// Initialize
showLogin();8:58 AM 11/5/2025