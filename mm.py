from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit
from flask_sqlalchemy import SQLAlchemy
import random
import string
from datetime import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here-change-in-production'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chat.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# مدل‌های دیتابیس (همان مدل‌های قبلی)
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120))
    phone = db.Column(db.String(20))
    connection_code = db.Column(db.String(10), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_code = db.Column(db.String(10), nullable=False)
    receiver_code = db.Column(db.String(10), nullable=False)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_read = db.Column(db.Boolean, default=False)

class Contact(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_code = db.Column(db.String(10), nullable=False)
    contact_code = db.Column(db.String(10), nullable=False)
    contact_name = db.Column(db.String(100), nullable=False)

# ایجاد دیتابیس
with app.app_context():
    db.create_all()

def generate_connection_code():
    return ''.join(random.choices(string.digits, k=10))

# Routes
@app.route('/')
def index():
    return render_template('complete_chat.html')

@app.route('/login', methods=['POST'])
def login():
    identifier = request.form['identifier']
    
    user = User.query.filter(
        (User.email == identifier) | 
        (User.phone == identifier) | 
        (User.connection_code == identifier)
    ).first()
    
    if user:
        session['user_code'] = user.connection_code
        session['username'] = user.username
        return jsonify({
            'username': user.username,
            'connection_code': user.connection_code
        })
    else:
        return jsonify({'error': 'User not found'}), 404

@app.route('/register', methods=['POST'])
def register():
    username = request.form['username']
    email = request.form.get('email', '')
    phone = request.form.get('phone', '')
    
    # بررسی وجود کاربر با همین نام کاربری
    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        return jsonify({'error': 'Username already exists'}), 400
    
    connection_code = generate_connection_code()
    
    new_user = User(
        username=username,
        email=email,
        phone=phone,
        connection_code=connection_code
    )
    
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({
        'username': username,
        'connection_code': connection_code
    })

@app.route('/contacts')
def contacts():
    if 'user_code' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    contacts = Contact.query.filter_by(user_code=session['user_code']).all()
    contacts_data = []
    for contact in contacts:
        contacts_data.append({
            'contact_code': contact.contact_code,
            'contact_name': contact.contact_name
        })
    
    return jsonify(contacts_data)

@app.route('/add_contact', methods=['POST'])
def add_contact():
    if 'user_code' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    contact_code = request.json.get('contact_code')
    contact = User.query.filter_by(connection_code=contact_code).first()
    
    if not contact:
        return jsonify({'error': 'User not found'}), 404
    
    # جلوگیری از اضافه کردن خود به عنوان مخاطب
    if contact_code == session['user_code']:
        return jsonify({'error': 'Cannot add yourself'}), 400
    
    existing_contact = Contact.query.filter_by(
        user_code=session['user_code'],
        contact_code=contact_code
    ).first()
    
    if not existing_contact:
        new_contact = Contact(
            user_code=session['user_code'],
            contact_code=contact_code,
            contact_name=contact.username
        )
        db.session.add(new_contact)
        db.session.commit()
    
    return jsonify({'success': True, 'contact_name': contact.username})

@app.route('/get_messages/<contact_code>')
def get_messages(contact_code):
    if 'user_code' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    messages = Message.query.filter(
        ((Message.sender_code == session['user_code']) & 
         (Message.receiver_code == contact_code)) |
        ((Message.sender_code == contact_code) & 
         (Message.receiver_code == session['user_code']))
    ).order_by(Message.timestamp.asc()).all()
    
    messages_data = []
    for msg in messages:
        messages_data.append({
            'id': msg.id,
            'sender': msg.sender_code,
            'content': msg.content,
            'timestamp': msg.timestamp.strftime('%H:%M'),
            'is_read': msg.is_read
        })
    
    return jsonify(messages_data)

# WebSocket Events (همان events قبلی)
@socketio.on('connect')
def handle_connect():
    if 'user_code' in session:
        emit('user_status', {'user': session['user_code'], 'status': 'online'})

@socketio.on('disconnect')
def handle_disconnect():
    if 'user_code' in session:
        emit('user_status', {'user': session['user_code'], 'status': 'offline'})

@socketio.on('send_message')
def handle_send_message(data):
    sender_code = session.get('user_code')
    if not sender_code:
        return
    
    receiver_code = data['receiver']
    content = data['content']
    
    new_message = Message(
        sender_code=sender_code,
        receiver_code=receiver_code,
        content=content
    )
    db.session.add(new_message)
    db.session.commit()
    
    message_data = {
        'sender': sender_code,
        'content': content,
        'timestamp': datetime.utcnow().strftime('%H:%M'),
        'id': new_message.id
    }
    
    emit('receive_message', message_data, room=receiver_code)
    emit('receive_message', message_data, room=sender_code)

@socketio.on('typing')
def handle_typing(data):
    emit('user_typing', {
        'user': session['user_code'],
        'is_typing': data['is_typing']
    }, room=data['receiver'])

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
