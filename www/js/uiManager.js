/**
 * Module for the UI controller logic
 */

define(['./lib/es6-promise', './tableManager'], function(es6, tableManager) {

    var result = 'server', // default radio button selection
        api;

    api = {
        displayItems: displayItems,
        init: init,
        resolve: resolve,
        updateSummaryMessage: updateSummaryMessage
    };

    return api;

    /**
     * Init
     */
    function init() {
        // Wire up the UI Event Handler for the Add Item
        $('#add-item').submit(addItemHandler);
        $('#refresh').on('click', refreshData);

        return tableManager.setUiManager(api);
    }

    function resolve(clientRecord) {
        setConflictResolutionCandidate(clientRecord);

        $('#server').on('click', function() { // resolve using server value
            result = 'server';
            $('#custominput').val('');
            $('#custominput').hide();
        });
        $('#client').on('click', function() { // resolve using custom value
            result = 'client';
            $('#custominput').val('');
            $('#custominput').hide();
        });
        $('#skip').on('click', function() { // skip conflict resolution for this record
            result = 'skip';
            $('#custominput').val('');
            $('#custominput').hide();
        });
        $('#custom').on('click', function() { // resolve using a custom user specified value
            result = undefined;
            $('#custominput').show();
        });

        return new es6.Promise(showConflictDialog);
    }

    // popup the conflict resolution dialog
    function showConflictDialog(resolve, reject) {
        $('#dialog').show();
        $("#dialog").dialog({
            modal: true,
            resizable: true,
            close: function() {
                try {
                    if (result !== 'server' && result !== 'client' && result !== 'skip') {
                        result = JSON.parse($('#custominput').val());
                    }

                    resolve(result);
                } catch(error) {
                    window.alert('Invalid conflict resolution');
                    showConflictDialog(resolve ,reject);
                }
            }
        });
    }

    function setConflictResolutionCandidate(record) {
        var value = JSON.parse(JSON.stringify(record));
        delete value.id;
        delete value.deleted;
        delete value.version;

        $('#custominput').val(JSON.stringify(value));
    }

    /**
     * Displays the table items
     */
    function displayItems() {
        // Execute a query for uncompleted items and process
        return tableManager
                .getTable()
                .then(function(table) {
                    return table
                            .where({complete: false})
                            .read();
                })
                .then(createTodoItemList, handleError);
    }

    /**
     * Event handler for when the user enters some text and clicks on Add
     * @param {Event} event the event that caused the request
     * @returns {void}
     */
    function addItemHandler(event) {
        var textbox = $('#new-item-text'),
            itemText = textbox.val();

        updateSummaryMessage('Adding new task..');
        if (itemText !== '') {
            tableManager
                .getTable()
                .then(function(table) {
                    return table.insert({
                        text: itemText,
                        complete: false
                    });
                })
                .then(displayItems, handleError)
                .then(function() {
                    return updateSummaryMessage('Added task!');
                });
        }

        textbox.val('').focus();
        event.preventDefault();
    }

    /**
     * Event handler for when the user clicks on Delete next to a todo item
     * @param {Event} event the event that caused the request
     * @returns {void}
     */
    function deleteItemHandler(event) {
        var itemId = getTodoItemId(event.currentTarget);

        updateSummaryMessage('Deleting task...');
        tableManager
            .getTable()
            .then(function(table) {
                return table.del({ id: itemId })   // Async send the deletion to backend
            })
            .then(displayItems, handleError)
            .then(function() {
                return updateSummaryMessage('Deleted task!');
            });
        
        event.preventDefault();
    }

    /**
     * Event handler for when the user updates the text of a todo item
     * @param {Event} event the event that caused the request
     * @returns {void}
     */
    function updateItemTextHandler(event) {
        var itemId = getTodoItemId(event.currentTarget),
            newText = $(event.currentTarget).val();

        updateSummaryMessage('Updating ToDo list...');
        tableManager
            .getTable()
            .then(function(table) {
                return table.update({ id: itemId, text: newText }); // Async send the update to backend
            })
            .then(displayItems, handleError)
            .then(function() {
                return updateSummaryMessage('Updated task!');
            });
        
        event.preventDefault();
    }

    /**
     * Event handler for when the user updates the completed checkbox of a todo item
     * @param {Event} event the event that caused the request
     * @returns {void}
     */
    function updateItemCompleteHandler(event) {
        var itemId = getTodoItemId(event.currentTarget),
            isComplete = $(event.currentTarget).prop('checked');

        updateSummaryMessage('Updating ToDo list...');
        tableManager
            .getTable()
            .then(function(table) {
                return table.update({ id: itemId, complete: isComplete })  // Async send the update to backend
            })
            .then(displayItems, handleError)
            .then(function() {
                return updateSummaryMessage('Updated task!');
            });
    }
    
    /**
     * Refresh the items within the page
     */
    function refreshData() {
        updateSummaryMessage('Refreshing ToDo list...');

        // Push the local changes, pull the latest changes and display the todo items
        tableManager
            .refresh()
            .then(function() {
                return displayItems();
            })
            .then(function() {
                return updateSummaryMessage('Refreshed ToDo list!');
            });
    }
    
    /**
     * Updates the Summary Message
     * @param {string} msg the message to use
     * @returns {void}
     */
    function updateSummaryMessage(msg) {
        $('#summary').html('<strong>' + msg + '</strong>');
    }

    /**
     * Given a sub-element of an LI, find the TodoItem ID associated with the list member
     *
     * @param {DOMElement} el the form element
     * @returns {string} the ID of the TodoItem
     */
    function getTodoItemId(el) {
        return $(el).closest('li').attr('data-todoitem-id');
    }


    /**
     * Create a list of Todo Items
     * @param {TodoItem[]} items an array of todoitem objects
     * @returns {void}
     */
    function createTodoItemList(items) {
        // Cycle through each item received from Azure and add items to the item list
        var listItems = $.map(items, createTodoItem);
        $('#todo-items').empty().append(listItems).toggle(listItems.length > 0);

        // Wire up the event handlers for each item in the list
        $('.item-delete').on('click', deleteItemHandler);
        $('.item-text').on('change', updateItemTextHandler);
        $('.item-complete').on('change', updateItemCompleteHandler);

    }

    /**
     * Create the DOM for a single todo item
     * @param {Object} item the Todo Item
     * @param {string} item.id the ID of the item
     * @param {bool} item.complete true if the item is completed
     * @param {string} item.text the text value
     * @returns {jQuery} jQuery DOM object
     */
    function createTodoItem(item) {
        return $('<li>')
            .attr('data-todoitem-id', item.id)
            .append($('<button class="item-delete">Delete</button>'))
            .append($('<input type="checkbox" class="item-complete">').prop('checked', item.complete))
            .append($('<div>').append($('<input class="item-text">').val(item.text)));
    }

    /**
     * Handle error conditions
     * @param {Error} error the error that needs handling
     * @returns {void}
     */
    function handleError(error) {
        var text = error + (error.request ? ' - ' + error.request.status : '');
        console.error(text);
        updateSummaryMessage('');
        $('#errorlog').append($('<li>').text(text));

        throw error;
    }
});